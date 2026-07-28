use account_data_native_program::state::AddressInfo;
use borsh::BorshDeserialize;
use litesvm::LiteSVM;

use solana_keypair::Keypair;
use solana_message::{AccountMeta, Instruction};
use solana_native_token::LAMPORTS_PER_SOL;
use solana_pubkey::Pubkey;
use solana_signer::Signer;
use solana_transaction::Transaction;

#[test]
fn test_account_data() {
    let mut svm = LiteSVM::new();

    let address_info_account = Keypair::new();
    let payer = Keypair::new();
    let program_id = Pubkey::new_unique();

    svm.airdrop(&payer.pubkey(), LAMPORTS_PER_SOL * 10).unwrap();

    let program_bytes = include_bytes!("../../tests/fixtures/account_data_native_program.so");

    svm.add_program(program_id, program_bytes).unwrap();

    let accounts = vec![
        AccountMeta::new(address_info_account.pubkey(), true),
        AccountMeta::new(payer.pubkey(), true),
        AccountMeta::new(solana_system_interface::program::ID, false),
    ];

    let data = AddressInfo::new("Joe C".to_string(), 136, "Mile High Dr.".to_string(), "Solana Beach".to_string());

    let ix = Instruction { program_id, accounts, data: borsh::to_vec(&data).unwrap() };

    let tx = Transaction::new_signed_with_payer(
        &[ix],
        Some(&payer.pubkey()),
        &[&payer, &address_info_account],
        svm.latest_blockhash(),
    );

    assert!(svm.send_transaction(tx).is_ok());

    let address_info_account_data = &svm.get_account(&address_info_account.pubkey()).unwrap().data;

    let serialized_data = AddressInfo::try_from_slice(address_info_account_data).unwrap();

    assert_eq!(serialized_data.name, data.name);
    assert_eq!(serialized_data.house_number, data.house_number);
    assert_eq!(serialized_data.street, data.street);
    assert_eq!(serialized_data.city, data.city);
}
