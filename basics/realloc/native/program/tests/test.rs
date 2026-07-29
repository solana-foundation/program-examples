use litesvm::LiteSVM;
use realloc_program::state::{AddressInfo, WorkInfo};
use realloc_program::{processor::ReallocInstruction, state::EnhancedAddressInfoExtender};
use solana_instruction::Instruction;
use solana_keypair::{Keypair, Signer};
use solana_native_token::LAMPORTS_PER_SOL;
use solana_pubkey::Pubkey;
use solana_transaction::{AccountMeta, Transaction};

#[test]
fn test_realloc() {
    let mut svm = LiteSVM::new();

    let program_id = Pubkey::new_unique();
    let program_bytes = include_bytes!("../../tests/fixtures/realloc_program.so");

    svm.add_program(program_id, program_bytes).unwrap();

    let payer = Keypair::new();
    svm.airdrop(&payer.pubkey(), LAMPORTS_PER_SOL).unwrap();

    let test_account = Keypair::new();

    let address_info = AddressInfo {
        name: "Jacob".to_string(),
        house_number: 123,
        street: "Main St.".to_string(),
        city: "Chicago".to_string(),
    };

    let data = borsh::to_vec(&ReallocInstruction::Create(address_info)).unwrap();

    let ix = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(test_account.pubkey(), true),
            AccountMeta::new(payer.pubkey(), true),
            AccountMeta::new(solana_system_interface::program::ID, false),
        ],
        data,
    };

    let tx = Transaction::new_signed_with_payer(
        &[ix],
        Some(&payer.pubkey()),
        &[&payer, &test_account],
        svm.latest_blockhash(),
    );

    assert!(svm.send_transaction(tx).is_ok());

    let data = borsh::to_vec(&ReallocInstruction::ReallocateWithoutZeroInit(EnhancedAddressInfoExtender {
        state: "Illinois".to_string(),
        zip: 12345,
    }))
    .unwrap();

    let ix = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(test_account.pubkey(), false),
            AccountMeta::new(payer.pubkey(), true),
            AccountMeta::new(solana_system_interface::program::ID, false),
        ],
        data,
    };

    let tx = Transaction::new_signed_with_payer(&[ix], Some(&payer.pubkey()), &[&payer], svm.latest_blockhash());

    assert!(svm.send_transaction(tx).is_ok());

    let data = borsh::to_vec(&ReallocInstruction::ReallocateZeroInit(WorkInfo {
        name: "Pete".to_string(),
        position: "Engineer".to_string(),
        company: "Solana Labs".to_string(),
        years_employed: 2,
    }))
    .unwrap();

    let ix = Instruction { program_id, accounts: vec![AccountMeta::new(test_account.pubkey(), false)], data };

    let tx = Transaction::new_signed_with_payer(&[ix], Some(&payer.pubkey()), &[&payer], svm.latest_blockhash());

    assert!(svm.send_transaction(tx).is_ok());
}
