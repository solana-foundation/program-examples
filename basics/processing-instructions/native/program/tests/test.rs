use litesvm::LiteSVM;
use processing_instructions_program::InstructionData;
use solana_instruction::{AccountMeta, Instruction};
use solana_keypair::{Keypair, Signer};
use solana_native_token::LAMPORTS_PER_SOL;
use solana_pubkey::Pubkey;
use solana_transaction::Transaction;

#[test]
fn test_processing_ixs() {
    let mut svm = LiteSVM::new();

    let program_id = Pubkey::new_unique();
    let program_bytes = include_bytes!("../../tests/fixtures/processing_instructions_program.so");

    svm.add_program(program_id, program_bytes).unwrap();

    let payer = Keypair::new();
    svm.airdrop(&payer.pubkey(), LAMPORTS_PER_SOL * 10).unwrap();

    let jimmy = InstructionData { name: "Jimmy".to_string(), height: 3 };

    let mary = InstructionData { name: "Mary".to_string(), height: 3 };

    let ix1 = Instruction {
        program_id,
        accounts: vec![AccountMeta::new(payer.pubkey(), true)],
        data: borsh::to_vec(&jimmy).unwrap(),
    };

    let ix2 = Instruction {
        program_id,
        accounts: vec![AccountMeta::new(payer.pubkey(), true)],
        data: borsh::to_vec(&mary).unwrap(),
    };

    let tx = Transaction::new_signed_with_payer(&[ix1, ix2], Some(&payer.pubkey()), &[&payer], svm.latest_blockhash());

    assert!(svm.send_transaction(tx).is_ok());
}
