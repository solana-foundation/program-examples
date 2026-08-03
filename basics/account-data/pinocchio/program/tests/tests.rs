use account_data_pinocchio_program::AddressInfo;
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

    let program_bytes = include_bytes!("../../tests/fixtures/account_data_pinocchio_program.so");

    svm.add_program(program_id, program_bytes).unwrap();

    let accounts = vec![
        AccountMeta::new(address_info_account.pubkey(), true),
        AccountMeta::new(payer.pubkey(), true),
        AccountMeta::new(solana_system_interface::program::ID, false),
    ];

    let data = AddressInfo {
        name: "Joe C".as_bytes(),
        house_number: 136,
        street: "Mile High Dr.".as_bytes(),
        city: "Solana Beach".as_bytes(),
    };

    let ix = Instruction { program_id, accounts, data: to_bytes(&data) };

    let tx = Transaction::new_signed_with_payer(
        &[ix],
        Some(&payer.pubkey()),
        &[&payer, &address_info_account],
        svm.latest_blockhash(),
    );

    let res = svm.send_transaction(tx);
    assert!(res.is_ok());

    let address_info_account_data = &svm.get_account(&address_info_account.pubkey()).unwrap().data;

    let address_info = AddressInfo {
        name: &address_info_account_data[0..16],
        house_number: address_info_account_data[17],
        street: &address_info_account_data[18..34],
        city: &address_info_account_data[35..51],
    };

    let mut name_str = String::from_utf8(address_info.name.to_vec()).unwrap();
    name_str.retain(|c| c != '\0');

    let mut street_str = String::from_utf8(address_info.street.to_vec()).unwrap();
    street_str.retain(|c| c != '\0');

    let mut city_str = String::from_utf8(address_info.city.to_vec()).unwrap();
    city_str.retain(|c| c != '\0');

    assert_eq!(name_str, String::from_utf8(data.name.to_vec()).unwrap());
    assert_eq!(street_str, String::from_utf8(data.street.to_vec()).unwrap());
    assert_eq!(city_str, String::from_utf8(data.city.to_vec()).unwrap());
}

fn to_bytes(address_info_data: &AddressInfo) -> Vec<u8> {
    let mut data = Vec::new();

    data.push(0);

    // Pad name to 16 bytes (data[0..16])
    let mut name = [0u8; 16];
    let name_len = address_info_data.name.len().min(16);
    name[..name_len].copy_from_slice(&address_info_data.name[..name_len]);
    data.extend_from_slice(&name);

    // Add 1 byte padding at index 16
    data.push(0);

    // Add house_number at index 17
    data.push(address_info_data.house_number);

    // Pad street to 16 bytes (data[18..34])
    let mut street = [0u8; 16];
    let street_len = address_info_data.street.len().min(16);
    street[..street_len].copy_from_slice(&address_info_data.street[..street_len]);
    data.extend_from_slice(&street);

    // Add 1 byte padding at index 34
    data.push(0);

    // Pad city to 16 bytes (data[35..51])
    let mut city = [0u8; 16];
    let city_len = address_info_data.city.len().min(16);
    city[..city_len].copy_from_slice(&address_info_data.city[..city_len]);
    data.extend_from_slice(&city);

    data
}
