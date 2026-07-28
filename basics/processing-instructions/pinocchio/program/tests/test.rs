use litesvm::LiteSVM;
use solana_instruction::{AccountMeta, Instruction};
use solana_keypair::{Keypair, Signer};
use solana_native_token::LAMPORTS_PER_SOL;
use solana_pubkey::Pubkey;
use solana_transaction::Transaction;

#[test]
fn test_processing_ixs() {
    let mut svm = LiteSVM::new();

    let program_id = Pubkey::new_unique();
    let program_bytes = include_bytes!("../../tests/fixtures/processing_instructions_pinocchio_program.so");

    svm.add_program(program_id, program_bytes).unwrap();

    let payer = Keypair::new();
    svm.airdrop(&payer.pubkey(), LAMPORTS_PER_SOL * 10).unwrap();

    let mut jimmy_data = Vec::new();

    let mut name1 = [0_u8; 8];
    let name1_len = "Jimmy".len().min(8);
    name1[..name1_len].copy_from_slice(b"Jimmy");
    jimmy_data.extend_from_slice(&name1);
    jimmy_data.extend_from_slice(&u32::to_le_bytes(3));

    let mut mary_data = Vec::new();

    let mut name2 = [0_u8; 8];
    let name2_len = "mary".len().min(8);
    name2[..name2_len].copy_from_slice(b"Mary");
    mary_data.extend_from_slice(&name2);
    mary_data.extend_from_slice(&u32::to_le_bytes(3));

    let ix1 = Instruction { program_id, accounts: vec![AccountMeta::new(payer.pubkey(), true)], data: jimmy_data };

    let ix2 = Instruction { program_id, accounts: vec![AccountMeta::new(payer.pubkey(), true)], data: mary_data };

    let tx = Transaction::new_signed_with_payer(&[ix1, ix2], Some(&payer.pubkey()), &[&payer], svm.latest_blockhash());

    let res = svm.send_transaction(tx);
    dbg!(&res);
    assert!(res.is_ok());
}
