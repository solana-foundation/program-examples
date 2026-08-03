use close_account_native_program::state::user::User;
use litesvm::LiteSVM;
use solana_instruction::{AccountMeta, Instruction};
use solana_keypair::{Keypair, Signer};
use solana_native_token::LAMPORTS_PER_SOL;
use solana_pubkey::Pubkey;
use solana_transaction::Transaction;

use close_account_native_program::processor::MyInstruction;

#[test]
fn test_close_account() {
    let mut svm = LiteSVM::new();

    let program_id = Pubkey::new_unique();
    let program_bytes = include_bytes!("../../tests/fixtures/close_account_native_program.so");

    svm.add_program(program_id, program_bytes).unwrap();

    let payer = Keypair::new();
    svm.airdrop(&payer.pubkey(), LAMPORTS_PER_SOL * 10).unwrap();

    let test_account_pubkey =
        Pubkey::find_program_address(&[b"USER".as_ref(), &payer.pubkey().as_ref()], &program_id).0;

    // create user ix
    let data = borsh::to_vec(&MyInstruction::CreateUser(User { name: "Jacob".to_string() })).unwrap();

    let ix = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(test_account_pubkey, false),
            AccountMeta::new(payer.pubkey(), true),
            AccountMeta::new(solana_system_interface::program::ID, false),
        ],
        data,
    };

    let tx = Transaction::new_signed_with_payer(&[ix], Some(&payer.pubkey()), &[&payer], svm.latest_blockhash());

    assert!(svm.send_transaction(tx).is_ok());

    // clsose user ix
    let data = borsh::to_vec(&MyInstruction::CloseUser).unwrap();

    let ix = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(test_account_pubkey, false),
            AccountMeta::new(payer.pubkey(), true),
            AccountMeta::new(solana_system_interface::program::ID, false),
        ],
        data,
    };

    let tx = Transaction::new_signed_with_payer(&[ix], Some(&payer.pubkey()), &[&payer], svm.latest_blockhash());

    assert!(svm.send_transaction(tx).is_ok());
}
