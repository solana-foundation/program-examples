use litesvm::LiteSVM;
use solana_keypair::{Keypair, Signer};
use solana_native_token::LAMPORTS_PER_SOL;
use solana_pubkey::Pubkey;
use solana_system_interface::instruction::create_account;
use solana_transaction::{AccountMeta, Instruction, Transaction};

#[test]
fn test_checking_accounts() {
    let mut svm = LiteSVM::new();

    let payer = Keypair::new();
    let account_to_change = Keypair::new();
    let account_to_create = Keypair::new();

    svm.airdrop(&payer.pubkey(), LAMPORTS_PER_SOL * 10).unwrap();

    let program_id = Pubkey::new_unique();
    let program_bytes = include_bytes!("../../tests/fixtures/checking_accounts_pinocchio_program.so");

    svm.add_program(program_id, program_bytes).unwrap();

    let create_account_ix =
        create_account(&payer.pubkey(), &account_to_change.pubkey(), LAMPORTS_PER_SOL, 0, &program_id);

    let tx = Transaction::new_signed_with_payer(
        &[create_account_ix],
        Some(&payer.pubkey()),
        &[&payer, &account_to_change],
        svm.latest_blockhash(),
    );

    // verify tx was sent successfully
    assert!(svm.send_transaction(tx).is_ok());

    let ix = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(payer.pubkey(), true),
            AccountMeta::new(account_to_create.pubkey(), true),
            AccountMeta::new(account_to_change.pubkey(), true),
            AccountMeta::new(solana_system_interface::program::ID, false),
        ],
        data: vec![0],
    };

    let tx = Transaction::new_signed_with_payer(
        &[ix],
        Some(&payer.pubkey()),
        &[payer, account_to_change, account_to_create],
        svm.latest_blockhash(),
    );

    // verify tx was sent successfully
    assert!(svm.send_transaction(tx).is_ok());
}
