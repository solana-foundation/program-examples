use {
    abl_token::{accounts::InitConfig, accounts::InitMint, accounts::ResizeMetaList, instructions::InitMintArgs, Mode},
    anchor_lang::solana_program::system_instruction::create_account,
    anchor_lang::InstructionData,
    anchor_lang::ToAccountMetas,
    anchor_spl::token_2022::{
        spl_token_2022::{
            self,
            extension::{transfer_hook, ExtensionType},
            instruction::initialize_mint2,
        },
        ID as TOKEN_22_PROGRAM_ID,
    },
    litesvm::LiteSVM,
    solana_account::Account,
    solana_instruction::Instruction,
    solana_keypair::Keypair,
    solana_message::Message,
    solana_native_token::LAMPORTS_PER_SOL,
    solana_pubkey::Pubkey,
    solana_sdk_ids::system_program::ID as SYSTEM_PROGRAM_ID,
    solana_signer::Signer,
    solana_transaction::Transaction,
    spl_tlv_account_resolution::{account::ExtraAccountMeta, seeds::Seed, state::ExtraAccountMetaList},
    spl_transfer_hook_interface::instruction::ExecuteInstruction,
    std::path::PathBuf,
};

const PROGRAM_ID: Pubkey = abl_token::ID_CONST;

fn setup() -> (LiteSVM, Keypair) {
    let mut svm = LiteSVM::new();
    let admin_kp = Keypair::new();
    let admin_pk = admin_kp.pubkey();

    svm.airdrop(&admin_pk, 10000 * LAMPORTS_PER_SOL).unwrap();

    let mut so_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    so_path.push("../../target/deploy/abl_token.so");

    println!("Deploying program from {}", so_path.display());

    let bytecode = std::fs::read(so_path).unwrap();

    svm.add_program(PROGRAM_ID, &bytecode);

    (svm, admin_kp)
}

/// Runs `init_config` then `init_mint` (with `admin_pk` as the mint's
/// `transfer_hook_authority`) and returns the resulting mint + meta-list
/// pubkeys, so tests that need a live mint don't have to repeat the setup.
fn setup_mint(svm: &mut LiteSVM, admin_kp: &Keypair) -> (Pubkey, Pubkey) {
    let admin_pk = admin_kp.pubkey();

    let mint_kp = Keypair::new();
    let mint_pk = mint_kp.pubkey();
    let config = derive_config();
    let meta_list = derive_meta_list(&mint_pk);

    let init_cfg_ix = abl_token::instruction::InitConfig {};

    let init_cfg_accounts = InitConfig { payer: admin_pk, config: config, system_program: SYSTEM_PROGRAM_ID };

    let accs = init_cfg_accounts.to_account_metas(None);

    let instruction = Instruction { program_id: PROGRAM_ID, accounts: accs, data: init_cfg_ix.data() };
    let msg = Message::new(&[instruction], Some(&admin_pk));
    let tx = Transaction::new(&[admin_kp], msg, svm.latest_blockhash());

    svm.send_transaction(tx).unwrap();

    let args: InitMintArgs = InitMintArgs {
        name: "Test".to_string(),
        symbol: "TEST".to_string(),
        uri: "https://test.com".to_string(),
        decimals: 6,
        mint_authority: mint_pk,
        freeze_authority: mint_pk,
        permanent_delegate: mint_pk,
        transfer_hook_authority: admin_pk,
        mode: Mode::Mixed,
        threshold: 100000,
    };
    let init_mint_ix = abl_token::instruction::InitMint { args: args };

    let data = init_mint_ix.data();

    let init_mint_accounts = InitMint {
        payer: admin_pk,
        mint: mint_pk,
        extra_metas_account: meta_list,
        system_program: SYSTEM_PROGRAM_ID,
        token_program: TOKEN_22_PROGRAM_ID,
    };

    let accs = init_mint_accounts.to_account_metas(None);

    let instruction = Instruction { program_id: PROGRAM_ID, accounts: accs, data: data };
    let msg = Message::new(&[instruction], Some(&admin_pk));
    let tx = Transaction::new(&[admin_kp, &mint_kp], msg, svm.latest_blockhash());

    svm.send_transaction(tx).unwrap();

    (mint_pk, meta_list)
}

#[test]
fn init_config_and_init_mint_succeed() {
    let (mut svm, admin_kp) = setup();
    setup_mint(&mut svm, &admin_kp);
}

#[test]
fn resize_meta_list_succeeds_and_is_idempotent() {
    let (mut svm, admin_kp) = setup();
    let admin_pk = admin_kp.pubkey();
    let (mint_pk, meta_list) = setup_mint(&mut svm, &admin_kp);

    // Fresh mints already get the current (2-entry) layout, so this is the
    // idempotent case: resizing to the same size and rewriting identical
    // content must still succeed and leave a well-formed account behind.
    let before = svm.get_account(&meta_list).unwrap().data;
    assert_eq!(before.len(), abl_token::get_meta_list_size().unwrap());

    let resize_ix = abl_token::instruction::ResizeMetaList {};
    let resize_accounts = ResizeMetaList {
        payer: admin_pk,
        mint: mint_pk,
        extra_metas_account: meta_list,
        system_program: SYSTEM_PROGRAM_ID,
        token_program: TOKEN_22_PROGRAM_ID,
    };
    let instruction = Instruction {
        program_id: PROGRAM_ID,
        accounts: resize_accounts.to_account_metas(None),
        data: resize_ix.data(),
    };
    let msg = Message::new(&[instruction], Some(&admin_pk));
    let tx = Transaction::new(&[&admin_kp], msg, svm.latest_blockhash());

    svm.send_transaction(tx).unwrap();

    let after = svm.get_account(&meta_list).unwrap().data;
    assert_eq!(after.len(), abl_token::get_meta_list_size().unwrap());
    assert_eq!(after, before);
}

#[test]
fn resize_meta_list_is_permissionless() {
    // Deliberately permissionless: gating this on the mint's transfer-hook
    // authority would permanently strand any mint whose authority was
    // revoked, since the content written doesn't depend on who calls it.
    let (mut svm, admin_kp) = setup();
    let (mint_pk, meta_list) = setup_mint(&mut svm, &admin_kp);

    let stranger_kp = Keypair::new();
    let stranger_pk = stranger_kp.pubkey();
    svm.airdrop(&stranger_pk, 10 * LAMPORTS_PER_SOL).unwrap();

    let resize_ix = abl_token::instruction::ResizeMetaList {};
    let resize_accounts = ResizeMetaList {
        payer: stranger_pk,
        mint: mint_pk,
        extra_metas_account: meta_list,
        system_program: SYSTEM_PROGRAM_ID,
        token_program: TOKEN_22_PROGRAM_ID,
    };
    let instruction = Instruction {
        program_id: PROGRAM_ID,
        accounts: resize_accounts.to_account_metas(None),
        data: resize_ix.data(),
    };
    let msg = Message::new(&[instruction], Some(&stranger_pk));
    let tx = Transaction::new(&[&stranger_kp], msg, svm.latest_blockhash());

    svm.send_transaction(tx).unwrap();
}

#[test]
fn resize_meta_list_rejects_a_mint_not_using_this_hook() {
    let (mut svm, admin_kp) = setup();
    let admin_pk = admin_kp.pubkey();

    // A mint whose TransferHook extension points at some other program.
    let mint_kp = Keypair::new();
    let mint_pk = mint_kp.pubkey();
    let other_program = Pubkey::new_unique();

    let space = ExtensionType::try_calculate_account_len::<spl_token_2022::state::Mint>(&[ExtensionType::TransferHook])
        .unwrap();
    let rent = svm.minimum_balance_for_rent_exemption(space);

    let create_ix = create_account(&admin_pk, &mint_pk, rent, space as u64, &TOKEN_22_PROGRAM_ID);
    let init_hook_ix =
        transfer_hook::instruction::initialize(&TOKEN_22_PROGRAM_ID, &mint_pk, Some(admin_pk), Some(other_program))
            .unwrap();
    let init_mint_ix = initialize_mint2(&TOKEN_22_PROGRAM_ID, &mint_pk, &admin_pk, None, 6).unwrap();

    let tx = Transaction::new(
        &[&admin_kp, &mint_kp],
        Message::new(&[create_ix, init_hook_ix, init_mint_ix], Some(&admin_pk)),
        svm.latest_blockhash(),
    );
    svm.send_transaction(tx).unwrap();

    let meta_list = derive_meta_list(&mint_pk);
    let resize_ix = abl_token::instruction::ResizeMetaList {};
    let resize_accounts = ResizeMetaList {
        payer: admin_pk,
        mint: mint_pk,
        extra_metas_account: meta_list,
        system_program: SYSTEM_PROGRAM_ID,
        token_program: TOKEN_22_PROGRAM_ID,
    };
    let instruction = Instruction {
        program_id: PROGRAM_ID,
        accounts: resize_accounts.to_account_metas(None),
        data: resize_ix.data(),
    };
    let msg = Message::new(&[instruction], Some(&admin_pk));
    let tx = Transaction::new(&[&admin_kp], msg, svm.latest_blockhash());

    let res = svm.send_transaction(tx);
    assert!(res.is_err(), "resizing a mint that isn't using this hook program must be rejected");
}

#[test]
fn resize_meta_list_migrates_a_mint_created_under_the_old_one_entry_layout() {
    let (mut svm, admin_kp) = setup();
    let admin_pk = admin_kp.pubkey();
    let (mint_pk, meta_list) = setup_mint(&mut svm, &admin_kp);

    // Overwrite the freshly-created (already-correct, 2-entry) meta list with
    // what a mint set up under the *old* program would actually have on
    // chain: a single entry resolving only the destination wallet. This is
    // the exact stale state Greptile flagged - upgrading the program alone
    // doesn't rewrite already-initialized accounts.
    let old_metas = vec![ExtraAccountMeta::new_with_seeds(
        &[
            Seed::Literal { bytes: b"ab_wallet".to_vec() },
            Seed::AccountData { account_index: 2, data_index: 32, length: 32 },
        ],
        false,
        false,
    )
    .unwrap()];
    let old_size = ExtraAccountMetaList::size_of(old_metas.len()).unwrap();
    let mut old_data = vec![0u8; old_size];
    ExtraAccountMetaList::init::<ExecuteInstruction>(&mut old_data, &old_metas).unwrap();

    let current_account = svm.get_account(&meta_list).unwrap();
    svm.set_account(
        meta_list,
        Account { lamports: svm.minimum_balance_for_rent_exemption(old_size), data: old_data, ..current_account },
    )
    .unwrap();
    assert_eq!(svm.get_account(&meta_list).unwrap().data.len(), old_size);

    let resize_ix = abl_token::instruction::ResizeMetaList {};
    let resize_accounts = ResizeMetaList {
        payer: admin_pk,
        mint: mint_pk,
        extra_metas_account: meta_list,
        system_program: SYSTEM_PROGRAM_ID,
        token_program: TOKEN_22_PROGRAM_ID,
    };
    let instruction = Instruction {
        program_id: PROGRAM_ID,
        accounts: resize_accounts.to_account_metas(None),
        data: resize_ix.data(),
    };
    let msg = Message::new(&[instruction], Some(&admin_pk));
    let tx = Transaction::new(&[&admin_kp], msg, svm.latest_blockhash());
    svm.send_transaction(tx).unwrap();

    let new_size = abl_token::get_meta_list_size().unwrap();
    let mut expected_data = vec![0u8; new_size];
    ExtraAccountMetaList::init::<ExecuteInstruction>(
        &mut expected_data,
        &abl_token::get_extra_account_metas().unwrap(),
    )
    .unwrap();

    let migrated = svm.get_account(&meta_list).unwrap();
    assert_eq!(migrated.data.len(), new_size, "meta list must be resized to the current 2-entry layout");
    assert_eq!(migrated.data, expected_data, "migrated meta list must match a freshly-initialized one exactly");
}

fn derive_config() -> Pubkey {
    let seeds = &[b"config".as_ref()];
    Pubkey::find_program_address(seeds, &PROGRAM_ID).0
}

fn derive_meta_list(mint: &Pubkey) -> Pubkey {
    let seeds = &[b"extra-account-metas", mint.as_ref()];
    Pubkey::find_program_address(seeds, &PROGRAM_ID).0
}
