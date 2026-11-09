use {
    anchor_lang::{
        prelude::Clock,
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
    fundraiser::state::{Contributor, Fundraiser},
    litesvm::LiteSVM,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

const SECONDS_PER_DAY: i64 = 86_400;

struct Env {
    svm: LiteSVM,
    payer: Keypair,
    maker: Keypair,
    fundraiser: Pubkey,
}

fn setup() -> Env {
    let mut svm = LiteSVM::new();
    let bytes = include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/../../target/deploy/fundraiser.so"));
    svm.add_program(fundraiser::id(), bytes).unwrap();
    let payer = Keypair::new();
    let maker = Keypair::new();
    svm.airdrop(&payer.pubkey(), 10_000_000_000).unwrap();
    svm.airdrop(&maker.pubkey(), 1_000_000_000).unwrap();
    let (fundraiser, _) = Pubkey::find_program_address(&[b"fundraiser", maker.pubkey().as_ref()], &fundraiser::id());
    Env { svm, payer, maker, fundraiser }
}

fn send(svm: &mut LiteSVM, ixs: &[Instruction], payer: &Keypair, signers: &[&Keypair]) -> Result<(), Vec<String>> {
    let msg = Message::new_with_blockhash(ixs, Some(&payer.pubkey()), &svm.latest_blockhash());
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), signers).unwrap();
    let result = svm.send_transaction(tx);
    svm.expire_blockhash();
    result.map(|_| ()).map_err(|failed| failed.meta.logs)
}

fn assert_anchor_error(result: Result<(), Vec<String>>, code: &str) {
    let logs = result.expect_err(&format!("expected {code}"));
    let needle = format!("Error Code: {code}.");
    assert!(logs.iter().any(|log| log.contains(&needle)), "expected {code}, got logs: {logs:#?}");
}

fn create_mint(svm: &mut LiteSVM, payer: &Keypair, authority: &Pubkey) -> Pubkey {
    let mint = Keypair::new();
    let ixs = [
        system_instruction::create_account(
            &payer.pubkey(),
            &mint.pubkey(),
            svm.minimum_balance_for_rent_exemption(spl_token::state::Mint::LEN),
            spl_token::state::Mint::LEN as u64,
            &spl_token::ID,
        ),
        spl_token::instruction::initialize_mint2(&spl_token::ID, &mint.pubkey(), authority, Some(authority), 6)
            .unwrap(),
    ];
    send(svm, &ixs, payer, &[payer, &mint]).unwrap();
    mint.pubkey()
}

fn token_balance(svm: &LiteSVM, token_account: &Pubkey) -> u64 {
    let account = svm.get_account(token_account).unwrap();
    spl_token::state::Account::unpack(&account.data).unwrap().amount
}

fn read<T: AccountDeserialize>(svm: &LiteSVM, address: &Pubkey) -> T {
    let account = svm.get_account(address).unwrap();
    T::try_deserialize(&mut account.data.as_slice()).unwrap()
}

fn initialize(env: &Env, mint: &Pubkey, amount: u64, duration: u16) -> Instruction {
    Instruction::new_with_bytes(
        fundraiser::id(),
        &fundraiser::instruction::Initialize { amount, duration }.data(),
        fundraiser::accounts::Initialize {
            maker: env.maker.pubkey(),
            mint_to_raise: *mint,
            fundraiser: env.fundraiser,
            vault: get_associated_token_address(&env.fundraiser, mint),
            system_program: system_program::ID,
            token_program: spl_token::ID,
            associated_token_program: associated_token::ID,
        }
        .to_account_metas(None),
    )
}

fn check_contributions(env: &Env, mint: &Pubkey) -> Instruction {
    Instruction::new_with_bytes(
        fundraiser::id(),
        &fundraiser::instruction::CheckContributions {}.data(),
        fundraiser::accounts::CheckContributions {
            maker: env.maker.pubkey(),
            mint_to_raise: *mint,
            fundraiser: env.fundraiser,
            vault: get_associated_token_address(&env.fundraiser, mint),
            maker_ata: get_associated_token_address(&env.maker.pubkey(), mint),
            token_program: spl_token::ID,
            system_program: system_program::ID,
            associated_token_program: associated_token::ID,
        }
        .to_account_metas(None),
    )
}

struct Campaign {
    mint: Pubkey,
    vault: Pubkey,
    contributor_ata: Pubkey,
    contributor_account: Pubkey,
}

impl Campaign {
    fn contribute(&self, env: &Env, amount: u64) -> Instruction {
        Instruction::new_with_bytes(
            fundraiser::id(),
            &fundraiser::instruction::Contribute { amount }.data(),
            fundraiser::accounts::Contribute {
                contributor: env.payer.pubkey(),
                mint_to_raise: self.mint,
                fundraiser: env.fundraiser,
                contributor_account: self.contributor_account,
                contributor_ata: self.contributor_ata,
                vault: self.vault,
                token_program: spl_token::ID,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        )
    }

    fn refund(&self, env: &Env) -> Instruction {
        Instruction::new_with_bytes(
            fundraiser::id(),
            &fundraiser::instruction::Refund {}.data(),
            fundraiser::accounts::Refund {
                contributor: env.payer.pubkey(),
                maker: env.maker.pubkey(),
                mint_to_raise: self.mint,
                fundraiser: env.fundraiser,
                contributor_account: self.contributor_account,
                contributor_ata: self.contributor_ata,
                vault: self.vault,
                token_program: spl_token::ID,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        )
    }
}

#[test]
fn fundraiser_lifecycle_and_refund_after_deadline() {
    let mut env = setup();

    let mint = create_mint(&mut env.svm, &env.payer, &env.payer.pubkey());
    let contributor_ata = get_associated_token_address(&env.payer.pubkey(), &mint);
    let setup_ixs = [
        create_associated_token_account(&env.payer.pubkey(), &env.payer.pubkey(), &mint, &spl_token::ID),
        create_associated_token_account(&env.payer.pubkey(), &env.maker.pubkey(), &mint, &spl_token::ID),
        spl_token::instruction::mint_to(&spl_token::ID, &mint, &contributor_ata, &env.payer.pubkey(), &[], 10_000_000)
            .unwrap(),
    ];
    send(&mut env.svm, &setup_ixs, &env.payer, &[&env.payer]).unwrap();

    let ix = initialize(&env, &mint, 30_000_000, 1);
    send(&mut env.svm, &[ix], &env.maker, &[&env.maker]).unwrap();

    let (contributor_account, _) = Pubkey::find_program_address(
        &[b"contributor", env.fundraiser.as_ref(), env.payer.pubkey().as_ref()],
        &fundraiser::id(),
    );
    let campaign = Campaign {
        mint,
        vault: get_associated_token_address(&env.fundraiser, &mint),
        contributor_ata,
        contributor_account,
    };

    for expected in [1_000_000, 2_000_000] {
        let ix = campaign.contribute(&env, 1_000_000);
        send(&mut env.svm, &[ix], &env.payer, &[&env.payer]).unwrap();
        assert_eq!(token_balance(&env.svm, &campaign.vault), expected);
        let contributor: Contributor = read(&env.svm, &contributor_account);
        assert_eq!(contributor.amount, expected);
    }

    let ix = campaign.contribute(&env, 2_000_000);
    assert_anchor_error(send(&mut env.svm, &[ix], &env.payer, &[&env.payer]), "MaximumContributionsReached");

    let vault_before = token_balance(&env.svm, &campaign.vault);
    let ix = campaign.refund(&env);
    assert_anchor_error(send(&mut env.svm, &[ix], &env.payer, &[&env.payer]), "FundraiserNotEnded");
    assert_eq!(token_balance(&env.svm, &campaign.vault), vault_before);

    let ix = check_contributions(&env, &mint);
    assert_anchor_error(send(&mut env.svm, &[ix], &env.maker, &[&env.maker]), "TargetNotMet");

    let state: Fundraiser = read(&env.svm, &env.fundraiser);
    let mut clock = env.svm.get_sysvar::<Clock>();
    clock.unix_timestamp = state.time_started + i64::from(state.duration) * SECONDS_PER_DAY;
    env.svm.set_sysvar(&clock);

    let ix = campaign.contribute(&env, 1_000_000);
    assert_anchor_error(send(&mut env.svm, &[ix], &env.payer, &[&env.payer]), "FundraiserEnded");

    let ix = campaign.refund(&env);
    send(&mut env.svm, &[ix], &env.payer, &[&env.payer]).unwrap();
    assert_eq!(token_balance(&env.svm, &campaign.vault), 0);
    assert_eq!(token_balance(&env.svm, &contributor_ata), 10_000_000);
    assert!(env.svm.get_account(&contributor_account).is_none_or(|a| a.lamports == 0));
}

#[test]
fn check_contributions_rejects_mint_other_than_recorded() {
    let mut env = setup();
    let amount_to_raise = 3_000_000;

    let real_mint = create_mint(&mut env.svm, &env.payer, &env.payer.pubkey());
    let fake_mint = create_mint(&mut env.svm, &env.payer, &env.maker.pubkey());

    let ix = initialize(&env, &real_mint, amount_to_raise, 0);
    send(&mut env.svm, &[ix], &env.maker, &[&env.maker]).unwrap();
    let state: Fundraiser = read(&env.svm, &env.fundraiser);
    assert_eq!(state.mint_to_raise, real_mint);

    let fake_vault = get_associated_token_address(&env.fundraiser, &fake_mint);
    let fund_ixs = [
        create_associated_token_account(&env.maker.pubkey(), &env.fundraiser, &fake_mint, &spl_token::ID),
        create_associated_token_account(&env.maker.pubkey(), &env.maker.pubkey(), &fake_mint, &spl_token::ID),
        spl_token::instruction::mint_to(
            &spl_token::ID,
            &fake_mint,
            &fake_vault,
            &env.maker.pubkey(),
            &[],
            amount_to_raise,
        )
        .unwrap(),
    ];
    send(&mut env.svm, &fund_ixs, &env.maker, &[&env.maker]).unwrap();

    let ix = check_contributions(&env, &fake_mint);
    assert_anchor_error(send(&mut env.svm, &[ix], &env.maker, &[&env.maker]), "ConstraintHasOne");

    let state: Fundraiser = read(&env.svm, &env.fundraiser);
    assert_eq!(state.mint_to_raise, real_mint);
    assert_eq!(token_balance(&env.svm, &fake_vault), amount_to_raise);
}

#[test]
fn large_targets_accept_contributions_and_enforce_ten_percent_cap() {
    for target in [u64::MAX / 10 + 1, u64::MAX] {
        let mut env = setup();
        let mint = create_mint(&mut env.svm, &env.payer, &env.payer.pubkey());
        let contributor_ata = get_associated_token_address(&env.payer.pubkey(), &mint);
        let setup_ixs = [
            create_associated_token_account(&env.payer.pubkey(), &env.payer.pubkey(), &mint, &spl_token::ID),
            spl_token::instruction::mint_to(
                &spl_token::ID,
                &mint,
                &contributor_ata,
                &env.payer.pubkey(),
                &[],
                u64::MAX,
            )
            .unwrap(),
        ];
        send(&mut env.svm, &setup_ixs, &env.payer, &[&env.payer]).unwrap();
        let ix = initialize(&env, &mint, target, 1);
        send(&mut env.svm, &[ix], &env.maker, &[&env.maker]).unwrap();
        let campaign = Campaign {
            mint,
            vault: get_associated_token_address(&env.fundraiser, &mint),
            contributor_ata,
            contributor_account: Pubkey::find_program_address(
                &[b"contributor", env.fundraiser.as_ref(), env.payer.pubkey().as_ref()],
                &fundraiser::id(),
            )
            .0,
        };
        let ix = campaign.contribute(&env, 1_000_000);
        send(&mut env.svm, &[ix], &env.payer, &[&env.payer]).unwrap();
        assert_eq!(token_balance(&env.svm, &campaign.vault), 1_000_000);
        let cap = target / 10;
        let ix = campaign.contribute(&env, cap + 1);
        assert_anchor_error(send(&mut env.svm, &[ix], &env.payer, &[&env.payer]), "ContributionTooBig");
        let ix = campaign.contribute(&env, cap - 1_000_000);
        send(&mut env.svm, &[ix], &env.payer, &[&env.payer]).unwrap();
        let ix = campaign.contribute(&env, 1);
        assert_anchor_error(send(&mut env.svm, &[ix], &env.payer, &[&env.payer]), "MaximumContributionsReached");
        assert_eq!(token_balance(&env.svm, &campaign.vault), cap);
        assert_eq!(token_balance(&env.svm, &contributor_ata), u64::MAX - cap);
        assert_eq!(read::<Contributor>(&env.svm, &campaign.contributor_account).amount, cap);
        assert_eq!(read::<Fundraiser>(&env.svm, &env.fundraiser).current_amount, cap);
    }
}
