use litesvm::LiteSVM;
use solana_instruction::Instruction;
use solana_keypair::{Keypair, Signer};
use solana_native_token::LAMPORTS_PER_SOL;
use solana_pubkey::Pubkey;
use solana_transaction::{AccountMeta, Transaction};

#[test]
fn test_realloc() {
    let mut svm = LiteSVM::new();

    let program_id = Pubkey::new_unique();
    let program_bytes = include_bytes!("../../tests/fixtures/realloc_pinocchio_program.so");

    svm.add_program(program_id, program_bytes).unwrap();

    let payer = Keypair::new();
    svm.airdrop(&payer.pubkey(), LAMPORTS_PER_SOL).unwrap();

    let test_account = Keypair::new();

    let mut data = Vec::new();

    data.push(0);

    let mut name: [u8; 8] = [0u8; 8];
    let len = "Jacob".len().min(8);
    name[..len].copy_from_slice(b"Jacob");
    data.extend_from_slice(&name);

    data.extend_from_slice(&u8::to_le_bytes(123));

    let mut street: [u8; 8] = [0u8; 8];
    let len = "Main St.".len().min(8);
    street[..len].copy_from_slice(b"Main St.");
    data.extend_from_slice(&street);

    let mut city: [u8; 8] = [0u8; 8];
    let len = "Chicago".len().min(8);
    city[..len].copy_from_slice(b"Chicago");
    data.extend_from_slice(&city);

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

    let res = svm.send_transaction(tx);
    assert!(res.is_ok());

    let mut data = Vec::new();
    data.push(1);

    let mut state: [u8; 8] = [0u8; 8];
    let len = "Illinois".len().min(8);
    state[..len].copy_from_slice(b"Illinois");
    data.extend_from_slice(&state);

    data.extend_from_slice(&u32::to_le_bytes(12345));

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

    let res = svm.send_transaction(tx);
    assert!(res.is_ok());

    let data = svm.get_account(&test_account.pubkey()).unwrap().data;
    let state = String::from_utf8(data[25..33].to_vec()).unwrap();
    let zip = u32::from_le_bytes(data[33..37].try_into().unwrap());
    assert_eq!("Illinois".to_string(), state);
    assert_eq!(12345, zip);

    svm.airdrop(&test_account.pubkey(), LAMPORTS_PER_SOL).unwrap();

    let mut data = Vec::new();

    data.push(2);

    let mut name: [u8; 8] = [0u8; 8];
    let len = "Perelyn".len().min(8);
    name[..len].copy_from_slice(b"Perelyn");
    data.extend_from_slice(&name);

    let mut position: [u8; 8] = [0u8; 8];
    let len = "Eng".len().min(8);
    position[..len].copy_from_slice(b"Eng");
    data.extend_from_slice(&position);

    let mut company: [u8; 8] = [0u8; 8];
    let len = "Anza".len().min(8);
    company[..len].copy_from_slice(b"Anza");
    data.extend_from_slice(&company);

    data.extend_from_slice(&u8::to_le_bytes(2));

    let ix = Instruction { program_id, accounts: vec![AccountMeta::new(test_account.pubkey(), false)], data };

    let tx = Transaction::new_signed_with_payer(&[ix], Some(&payer.pubkey()), &[&payer], svm.latest_blockhash());

    let res = svm.send_transaction(tx);
    assert!(res.is_ok());
}
