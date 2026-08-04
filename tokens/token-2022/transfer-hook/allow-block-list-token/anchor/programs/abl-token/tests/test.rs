use {
    abl_token::{accounts::InitConfig, accounts::InitMint, instructions::InitMintArgs, Mode},
    anchor_lang::InstructionData,
    anchor_lang::ToAccountMetas,
    anchor_spl::token_2022::ID as TOKEN_22_PROGRAM_ID,
    litesvm::LiteSVM,
    solana_instruction::Instruction,
    solana_keypair::Keypair,
    solana_message::Message,
    solana_native_token::LAMPORTS_PER_SOL,
    solana_pubkey::Pubkey,
    solana_sdk_ids::system_program::ID as SYSTEM_PROGRAM_ID,
    solana_signer::Signer,
    solana_transaction::Transaction,
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

#[test]
fn test() {
    let (mut svm, admin_kp) = setup();
    let admin_pk = admin_kp.pubkey();

    let mint_kp = Keypair::new();
    let mint_pk = mint_kp.pubkey();
    let config = derive_config();
    let meta_list = derive_meta_list(&mint_pk);

    let init_cfg_ix = abl_token::instruction::InitConfig {};

    let init_cfg_accounts = InitConfig {
        payer: admin_pk,
        config: config,
        system_program: SYSTEM_PROGRAM_ID,
    };

    let accs = init_cfg_accounts.to_account_metas(None);

    let instruction = Instruction {
        program_id: PROGRAM_ID,
        accounts: accs,
        data: init_cfg_ix.data(),
    };
    let msg = Message::new(&[instruction], Some(&admin_pk));
    let tx = Transaction::new(&[&admin_kp], msg, svm.latest_blockhash());

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

    let instruction = Instruction {
        program_id: PROGRAM_ID,
        accounts: accs,
        data: data,
    };
    let msg = Message::new(&[instruction], Some(&admin_pk));
    let tx = Transaction::new(&[&admin_kp, &mint_kp], msg, svm.latest_blockhash());

    let _res = svm.send_transaction(tx).unwrap();
}

fn derive_config() -> Pubkey {
    let seeds = &[b"config".as_ref()];
    Pubkey::find_program_address(seeds, &PROGRAM_ID).0
}

fn derive_meta_list(mint: &Pubkey) -> Pubkey {
    let seeds = &[b"extra-account-metas", mint.as_ref()];
    Pubkey::find_program_address(seeds, &PROGRAM_ID).0
}
