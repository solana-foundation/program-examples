use litesvm::LiteSVM;

use repository_layout_program::processor::CarnivalInstructionData;
use solana_instruction::{AccountMeta, Instruction};
use solana_keypair::{Keypair, Signer};
use solana_program::native_token::LAMPORTS_PER_SOL;
use solana_pubkey::Pubkey;
use solana_transaction::Transaction;

#[test]
fn test_repo_layout() {
    let mut svm = LiteSVM::new();

    let program_id = Pubkey::new_unique();
    let program_bytes = include_bytes!("../../tests/fixtures/repository_layout_program.so");

    svm.add_program(program_id, program_bytes).unwrap();

    let payer = Keypair::new();
    svm.airdrop(&payer.pubkey(), LAMPORTS_PER_SOL * 10).unwrap();

    let data = borsh::to_vec(&CarnivalInstructionData {
        name: "Jimmy".to_string(),
        height: 36,
        ticket_count: 15,
        attraction: "ride".to_string(),
        attraction_name: "Scrambler".to_string(),
    })
    .unwrap();

    let ix = Instruction { program_id, accounts: vec![AccountMeta::new(payer.pubkey(), true)], data };

    let tx = Transaction::new_signed_with_payer(&[ix], Some(&payer.pubkey()), &[&payer], svm.latest_blockhash());

    assert!(svm.send_transaction(tx).is_ok());

    let data = borsh::to_vec(&CarnivalInstructionData {
        name: "Jimmy".to_string(),
        height: 36,
        ticket_count: 15,
        attraction: "game".to_string(),
        attraction_name: "I Got It!".to_string(),
    })
    .unwrap();

    let ix = Instruction { program_id, accounts: vec![AccountMeta::new(payer.pubkey(), true)], data };

    let tx = Transaction::new_signed_with_payer(&[ix], Some(&payer.pubkey()), &[&payer], svm.latest_blockhash());

    assert!(svm.send_transaction(tx).is_ok());

    let data = borsh::to_vec(&CarnivalInstructionData {
        name: "Jimmy".to_string(),
        height: 36,
        ticket_count: 15,
        attraction: "food".to_string(),
        attraction_name: "Taco Shack".to_string(),
    })
    .unwrap();

    let ix = Instruction { program_id, accounts: vec![AccountMeta::new(payer.pubkey(), true)], data };

    let tx = Transaction::new_signed_with_payer(&[ix], Some(&payer.pubkey()), &[&payer], svm.latest_blockhash());

    assert!(svm.send_transaction(tx).is_ok());
}
