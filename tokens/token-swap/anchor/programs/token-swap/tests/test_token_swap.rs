use {
    anchor_lang::{
        solana_program::{
            instruction::Instruction, program_pack::Pack, pubkey::Pubkey, system_instruction, system_program,
        },
        AccountDeserialize, InstructionData, ToAccountMetas,
    },
    anchor_spl::{
        associated_token::{
            self, get_associated_token_address,
            spl_associated_token_account::instruction::create_associated_token_account,
        },
        token::spl_token,
    },
    litesvm::LiteSVM,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
    swap_example::state::{Amm, Pool},
};

const FEE: u16 = 500;
const MINIMUM_LIQUIDITY: u64 = 100;
const DEFAULT_SUPPLY: u64 = 100_000_000;
const DEPOSIT_AMOUNT_A: u64 = 4_000_000;
const DEPOSIT_AMOUNT_B: u64 = 1_000_000;

struct Env {
    svm: LiteSVM,
    payer: Keypair,
    admin: Keypair,
    id: Pubkey,
    amm: Pubkey,
    mint_a: Keypair,
    mint_b: Keypair,
}

struct PoolKeys {
    pool: Pubkey,
    pool_authority: Pubkey,
    mint_liquidity: Pubkey,
    pool_account_a: Pubkey,
    pool_account_b: Pubkey,
}

impl PoolKeys {
    fn derive(amm: &Pubkey, mint_a: &Pubkey, mint_b: &Pubkey) -> Self {
        let pda = |seeds: &[&[u8]]| Pubkey::find_program_address(seeds, &swap_example::id()).0;
        let base = [amm.as_ref(), mint_a.as_ref(), mint_b.as_ref()];
        let pool = pda(&base);
        let pool_authority = pda(&[base[0], base[1], base[2], b"authority"]);
        let mint_liquidity = pda(&[base[0], base[1], base[2], b"liquidity"]);
        Self {
            pool,
            pool_authority,
            mint_liquidity,
            pool_account_a: get_associated_token_address(&pool_authority, mint_a),
            pool_account_b: get_associated_token_address(&pool_authority, mint_b),
        }
    }
}

impl Env {
    fn new() -> Self {
        let mut svm = LiteSVM::new();
        let bytes = include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/../../target/deploy/swap_example.so"));
        svm.add_program(swap_example::id(), bytes).unwrap();
        let payer = Keypair::new();
        svm.airdrop(&payer.pubkey(), 10_000_000_000).unwrap();
        let id = Pubkey::new_unique();
        let amm = Pubkey::find_program_address(&[id.as_ref()], &swap_example::id()).0;
        let (mut mint_a, mut mint_b) = (Keypair::new(), Keypair::new());
        if mint_b.pubkey() < mint_a.pubkey() {
            std::mem::swap(&mut mint_a, &mut mint_b);
        }
        Self { svm, payer, admin: Keypair::new(), id, amm, mint_a, mint_b }
    }

    fn keys(&self) -> PoolKeys {
        PoolKeys::derive(&self.amm, &self.mint_a.pubkey(), &self.mint_b.pubkey())
    }

    fn holder_a(&self) -> Pubkey {
        get_associated_token_address(&self.admin.pubkey(), &self.mint_a.pubkey())
    }

    fn holder_b(&self) -> Pubkey {
        get_associated_token_address(&self.admin.pubkey(), &self.mint_b.pubkey())
    }

    fn liquidity_account(&self) -> Pubkey {
        get_associated_token_address(&self.admin.pubkey(), &self.keys().mint_liquidity)
    }

    fn balance(&self, token_account: &Pubkey) -> u64 {
        let account = self.svm.get_account(token_account).unwrap();
        spl_token::state::Account::unpack(&account.data).unwrap().amount
    }

    fn create_amm(&mut self, fee: u16) -> Result<(), Vec<String>> {
        let ix = Instruction::new_with_bytes(
            swap_example::id(),
            &swap_example::instruction::CreateAmm { id: self.id, fee }.data(),
            swap_example::accounts::CreateAmm {
                amm: self.amm,
                admin: self.admin.pubkey(),
                payer: self.payer.pubkey(),
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        );
        send(&mut self.svm, &self.payer, &[ix], &[])
    }

    fn mint_tokens(&mut self) {
        let admin = self.admin.pubkey();
        let payer = self.payer.pubkey();
        let mint_len = spl_token::state::Mint::LEN;
        let lamports = self.svm.minimum_balance_for_rent_exemption(mint_len);
        let mut ixs = Vec::new();
        for (mint, holder) in [(self.mint_a.pubkey(), self.holder_a()), (self.mint_b.pubkey(), self.holder_b())] {
            ixs.extend([
                system_instruction::create_account(&payer, &mint, lamports, mint_len as u64, &spl_token::ID),
                spl_token::instruction::initialize_mint2(&spl_token::ID, &mint, &admin, Some(&admin), 6).unwrap(),
                create_associated_token_account(&payer, &admin, &mint, &spl_token::ID),
                spl_token::instruction::mint_to(&spl_token::ID, &mint, &holder, &admin, &[], DEFAULT_SUPPLY).unwrap(),
            ]);
        }
        send(&mut self.svm, &self.payer, &ixs, &[&self.admin, &self.mint_a, &self.mint_b]).unwrap();
    }

    fn create_pool_with(&mut self, mint_a: Pubkey, mint_b: Pubkey) -> Result<(), Vec<String>> {
        let keys = PoolKeys::derive(&self.amm, &mint_a, &mint_b);
        let ix = Instruction::new_with_bytes(
            swap_example::id(),
            &swap_example::instruction::CreatePool {}.data(),
            swap_example::accounts::CreatePool {
                amm: self.amm,
                pool: keys.pool,
                pool_authority: keys.pool_authority,
                mint_liquidity: keys.mint_liquidity,
                mint_a,
                mint_b,
                pool_account_a: keys.pool_account_a,
                pool_account_b: keys.pool_account_b,
                payer: self.payer.pubkey(),
                token_program: spl_token::ID,
                associated_token_program: associated_token::ID,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        );
        send(&mut self.svm, &self.payer, &[ix], &[])
    }

    fn create_pool(&mut self) -> Result<(), Vec<String>> {
        self.create_pool_with(self.mint_a.pubkey(), self.mint_b.pubkey())
    }

    fn deposit(&mut self, amount_a: u64, amount_b: u64) {
        let admin = self.admin.insecure_clone();
        self.deposit_as(&admin, amount_a, amount_b).unwrap();
    }

    fn deposit_as(&mut self, depositor: &Keypair, amount_a: u64, amount_b: u64) -> Result<(), Vec<String>> {
        let keys = self.keys();
        let ix = Instruction::new_with_bytes(
            swap_example::id(),
            &swap_example::instruction::DepositLiquidity { amount_a, amount_b }.data(),
            swap_example::accounts::DepositLiquidity {
                pool: keys.pool,
                pool_authority: keys.pool_authority,
                depositor: depositor.pubkey(),
                mint_liquidity: keys.mint_liquidity,
                mint_a: self.mint_a.pubkey(),
                mint_b: self.mint_b.pubkey(),
                pool_account_a: keys.pool_account_a,
                pool_account_b: keys.pool_account_b,
                depositor_account_liquidity: get_associated_token_address(&depositor.pubkey(), &keys.mint_liquidity),
                depositor_account_a: get_associated_token_address(&depositor.pubkey(), &self.mint_a.pubkey()),
                depositor_account_b: get_associated_token_address(&depositor.pubkey(), &self.mint_b.pubkey()),
                payer: self.payer.pubkey(),
                token_program: spl_token::ID,
                associated_token_program: associated_token::ID,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        );
        send(&mut self.svm, &self.payer, &[ix], &[depositor])
    }

    fn withdraw(&mut self, amount: u64) {
        let keys = self.keys();
        let ix = Instruction::new_with_bytes(
            swap_example::id(),
            &swap_example::instruction::WithdrawLiquidity { amount }.data(),
            swap_example::accounts::WithdrawLiquidity {
                amm: self.amm,
                pool: keys.pool,
                pool_authority: keys.pool_authority,
                depositor: self.admin.pubkey(),
                mint_liquidity: keys.mint_liquidity,
                mint_a: self.mint_a.pubkey(),
                mint_b: self.mint_b.pubkey(),
                pool_account_a: keys.pool_account_a,
                pool_account_b: keys.pool_account_b,
                depositor_account_liquidity: self.liquidity_account(),
                depositor_account_a: self.holder_a(),
                depositor_account_b: self.holder_b(),
                payer: self.payer.pubkey(),
                token_program: spl_token::ID,
                associated_token_program: associated_token::ID,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        );
        send(&mut self.svm, &self.payer, &[ix], &[&self.admin]).unwrap();
    }

    fn swap(&mut self, swap_a: bool, input_amount: u64, min_output_amount: u64) {
        let keys = self.keys();
        let ix = Instruction::new_with_bytes(
            swap_example::id(),
            &swap_example::instruction::SwapExactTokensForTokens { swap_a, input_amount, min_output_amount }.data(),
            swap_example::accounts::SwapExactTokensForTokens {
                amm: self.amm,
                pool: keys.pool,
                pool_authority: keys.pool_authority,
                trader: self.admin.pubkey(),
                mint_a: self.mint_a.pubkey(),
                mint_b: self.mint_b.pubkey(),
                pool_account_a: keys.pool_account_a,
                pool_account_b: keys.pool_account_b,
                trader_account_a: self.holder_a(),
                trader_account_b: self.holder_b(),
                payer: self.payer.pubkey(),
                token_program: spl_token::ID,
                associated_token_program: associated_token::ID,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        );
        send(&mut self.svm, &self.payer, &[ix], &[&self.admin]).unwrap();
    }

    fn with_pool() -> Self {
        let mut env = Self::new();
        env.create_amm(FEE).unwrap();
        env.mint_tokens();
        env.create_pool().unwrap();
        env
    }
}

fn send(
    svm: &mut LiteSVM,
    payer: &Keypair,
    ixs: &[Instruction],
    extra_signers: &[&Keypair],
) -> Result<(), Vec<String>> {
    let mut signers = vec![payer];
    signers.extend_from_slice(extra_signers);
    let msg = Message::new_with_blockhash(ixs, Some(&payer.pubkey()), &svm.latest_blockhash());
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &signers).unwrap();
    let result = svm.send_transaction(tx);
    svm.expire_blockhash();
    result.map(|_| ()).map_err(|failed| failed.meta.logs)
}

fn read<T: AccountDeserialize>(svm: &LiteSVM, address: &Pubkey) -> T {
    let account = svm.get_account(address).unwrap();
    T::try_deserialize(&mut account.data.as_slice()).unwrap()
}

fn expected_output(input: u64, pool_in: u64, pool_out: u64) -> u64 {
    let taxed_input = input - input * u64::from(FEE) / 10_000;
    taxed_input * pool_out / (pool_in + taxed_input)
}

#[test]
fn create_amm() {
    let mut env = Env::new();
    env.create_amm(FEE).unwrap();

    let amm: Amm = read(&env.svm, &env.amm);
    assert_eq!(amm.id, env.id);
    assert_eq!(amm.admin, env.admin.pubkey());
    assert_eq!(amm.fee, FEE);
}

#[test]
fn create_amm_rejects_invalid_fee() {
    let mut env = Env::new();
    let logs = env.create_amm(10_000).unwrap_err();
    assert!(logs.iter().any(|log| log.contains("Error Code: InvalidFee.")));
    assert!(env.svm.get_account(&env.amm).is_none());
}

#[test]
fn create_pool() {
    let mut env = Env::new();
    env.create_amm(FEE).unwrap();
    env.mint_tokens();
    env.create_pool().unwrap();

    let keys = env.keys();
    let pool: Pool = read(&env.svm, &keys.pool);
    assert_eq!(pool.amm, env.amm);
    assert_eq!(pool.mint_a, env.mint_a.pubkey());
    assert_eq!(pool.mint_b, env.mint_b.pubkey());
    assert_eq!(env.balance(&keys.pool_account_a), 0);
    assert_eq!(env.balance(&keys.pool_account_b), 0);
}

#[test]
fn create_pool_rejects_identical_mints() {
    let mut env = Env::new();
    env.create_amm(FEE).unwrap();
    env.mint_tokens();

    let mint_a = env.mint_a.pubkey();
    assert!(env.create_pool_with(mint_a, mint_a).is_err());
    assert!(env.svm.get_account(&PoolKeys::derive(&env.amm, &mint_a, &mint_a).pool).is_none());
}

#[test]
fn deposit_equal_amounts() {
    let mut env = Env::with_pool();
    env.deposit(DEPOSIT_AMOUNT_A, DEPOSIT_AMOUNT_A);

    assert_eq!(env.balance(&env.liquidity_account()), DEPOSIT_AMOUNT_A - MINIMUM_LIQUIDITY);
    assert_eq!(env.balance(&env.holder_a()), DEFAULT_SUPPLY - DEPOSIT_AMOUNT_A);
    assert_eq!(env.balance(&env.holder_b()), DEFAULT_SUPPLY - DEPOSIT_AMOUNT_A);
}

#[test]
fn deposit_with_existing_liquidity_same_ratio() {
    let mut env = Env::with_pool();
    env.deposit(DEPOSIT_AMOUNT_A, DEPOSIT_AMOUNT_A);
    let second_deposit = 100_000;
    env.deposit(second_deposit, second_deposit);

    assert_eq!(env.balance(&env.keys().pool_account_a), DEPOSIT_AMOUNT_A + second_deposit);
}

#[test]
fn deposit_with_different_ratio_is_limited_by_pool_ratio() {
    let mut env = Env::with_pool();
    let (initial_a, initial_b) = (1_000_000, 5_000_000);
    env.deposit(initial_a, initial_b);

    let (second_a, second_b) = (500_000, 500_000);
    env.deposit(second_a, second_b);

    let keys = env.keys();
    let expected_additional_a = second_b * initial_a / initial_b;
    assert_eq!(env.balance(&keys.pool_account_a), initial_a + expected_additional_a);
    assert_eq!(env.balance(&keys.pool_account_b), initial_b + second_b);
}

fn assert_deposit_too_small(env: &mut Env, amount_a: u64, amount_b: u64) {
    let keys = env.keys();
    let accounts = [
        env.holder_a(),
        env.holder_b(),
        keys.pool_account_a,
        keys.pool_account_b,
        keys.mint_liquidity,
        env.liquidity_account(),
    ];
    let snapshot = |env: &Env| accounts.map(|key| env.svm.get_account(&key).map(|account| account.data));
    let before = snapshot(env);
    let admin = env.admin.insecure_clone();
    let logs = env.deposit_as(&admin, amount_a, amount_b).unwrap_err();
    assert!(logs.iter().any(|log| log.contains("Error Code: DepositTooSmall.")), "{logs:?}");
    // Comparing token account and mint data also checks balances and LP supply.
    assert_eq!(snapshot(env), before);
}

#[test]
fn deposit_at_locked_minimum_is_rejected() {
    let mut env = Env::with_pool();
    assert_deposit_too_small(&mut env, MINIMUM_LIQUIDITY, MINIMUM_LIQUIDITY);
}

#[test]
fn deposit_rounding_to_zero_shares_is_rejected() {
    let mut env = Env::with_pool();
    env.deposit(1_000, 1_000);
    let keys = env.keys();
    let transfers =
        [(env.holder_a(), keys.pool_account_a), (env.holder_b(), keys.pool_account_b)].map(|(source, destination)| {
            spl_token::instruction::transfer(&spl_token::ID, &source, &destination, &env.admin.pubkey(), &[], 1_000)
                .unwrap()
        });
    send(&mut env.svm, &env.payer, &transfers, &[&env.admin]).unwrap();
    assert_deposit_too_small(&mut env, 1, 1);
}

#[test]
fn deposit_into_one_sided_reserves_is_rejected() {
    for fund_a in [true, false] {
        let mut env = Env::with_pool();
        let keys = env.keys();
        let (source, destination) =
            if fund_a { (env.holder_a(), keys.pool_account_a) } else { (env.holder_b(), keys.pool_account_b) };
        let transfer =
            spl_token::instruction::transfer(&spl_token::ID, &source, &destination, &env.admin.pubkey(), &[], 1_000)
                .unwrap();
        send(&mut env.svm, &env.payer, &[transfer], &[&env.admin]).unwrap();
        assert_deposit_too_small(&mut env, 1_000, 1_000);
    }
}

#[test]
fn deposit_after_fee_growth_preserves_existing_lp_share() {
    let mut env = Env::with_pool();
    env.deposit(4_000_000, 4_000_000);
    env.swap(true, 2_000_000, 1);

    let keys = env.keys();
    let before_a = env.balance(&keys.pool_account_a);
    let before_b = env.balance(&keys.pool_account_b);
    let existing_lp = env.balance(&env.liquidity_account());
    let new_lp = Keypair::new();
    let new_lp_account = get_associated_token_address(&new_lp.pubkey(), &keys.mint_liquidity);
    let mut setup = Vec::new();
    for (mint, source) in [(env.mint_a.pubkey(), env.holder_a()), (env.mint_b.pubkey(), env.holder_b())] {
        let destination = get_associated_token_address(&new_lp.pubkey(), &mint);
        setup.push(create_associated_token_account(&env.payer.pubkey(), &new_lp.pubkey(), &mint, &spl_token::ID));
        setup.push(
            spl_token::instruction::transfer(
                &spl_token::ID,
                &source,
                &destination,
                &env.admin.pubkey(),
                &[],
                2_000_000,
            )
            .unwrap(),
        );
    }
    send(&mut env.svm, &env.payer, &setup, &[&env.admin]).unwrap();
    env.deposit_as(&new_lp, 1_000_000, 1_000_000).unwrap();

    let added_a = env.balance(&keys.pool_account_a) - before_a;
    let added_b = env.balance(&keys.pool_account_b) - before_b;
    let effective_supply = existing_lp + MINIMUM_LIQUIDITY;
    let max_lp_a = (added_a as u128 * effective_supply as u128 / before_a as u128) as u64;
    let max_lp_b = (added_b as u128 * effective_supply as u128 / before_b as u128) as u64;
    let minted_lp = env.balance(&new_lp_account);
    assert!(minted_lp > 0);
    assert_eq!(minted_lp, max_lp_a.min(max_lp_b), "new shares must reflect the actual contribution to both reserves");
    assert_eq!(env.balance(&env.liquidity_account()), existing_lp);
}

#[test]
fn swap_a_to_b() {
    let mut env = Env::with_pool();
    env.deposit(DEPOSIT_AMOUNT_A, DEPOSIT_AMOUNT_B);

    let input = 1_000_000;
    env.swap(true, input, 100);

    let output = expected_output(input, DEPOSIT_AMOUNT_A, DEPOSIT_AMOUNT_B);
    assert!(output > 0 && output < input);
    assert_eq!(env.balance(&env.holder_a()), DEFAULT_SUPPLY - DEPOSIT_AMOUNT_A - input);
    assert_eq!(env.balance(&env.holder_b()), DEFAULT_SUPPLY - DEPOSIT_AMOUNT_B + output);
}

#[test]
fn swap_b_to_a() {
    let mut env = Env::with_pool();
    env.deposit(DEPOSIT_AMOUNT_A, DEPOSIT_AMOUNT_B);

    let input = 3_000_000;
    env.swap(false, input, 100);

    assert_eq!(env.balance(&env.holder_b()), DEFAULT_SUPPLY - DEPOSIT_AMOUNT_B - input);
    assert_eq!(
        env.balance(&env.holder_a()),
        DEFAULT_SUPPLY - DEPOSIT_AMOUNT_A + expected_output(input, DEPOSIT_AMOUNT_B, DEPOSIT_AMOUNT_A)
    );
}

#[test]
fn withdraw_everything() {
    let mut env = Env::with_pool();
    env.deposit(DEPOSIT_AMOUNT_A, DEPOSIT_AMOUNT_A);
    env.withdraw(DEPOSIT_AMOUNT_A - MINIMUM_LIQUIDITY);

    assert_eq!(env.balance(&env.liquidity_account()), 0);
    for holder in [env.holder_a(), env.holder_b()] {
        let balance = env.balance(&holder);
        assert!(balance < DEFAULT_SUPPLY);
        assert!(balance > DEFAULT_SUPPLY - DEPOSIT_AMOUNT_A);
    }
}
