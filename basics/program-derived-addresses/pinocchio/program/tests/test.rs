use litesvm::LiteSVM;
use solana_instruction::{AccountMeta, Instruction};
use solana_keypair::{Keypair, Signer};
use solana_native_token::LAMPORTS_PER_SOL;
use solana_pubkey::Pubkey;
use solana_rent::Rent;
use solana_system_interface::instruction::create_account;
use solana_transaction::Transaction;

#[test]
fn test_pda() {
    let mut svm = LiteSVM::new();

    let program_id = Pubkey::new_unique();
    let program_bytes = include_bytes!("../../tests/fixtures/program_derived_addresses_pinocchio_program.so");
    svm.add_program(program_id, program_bytes).unwrap();

    let payer = Keypair::new();
    svm.airdrop(&payer.pubkey(), LAMPORTS_PER_SOL * 10).unwrap();

    let test_user = Keypair::new();

    let rent = Rent::default();

    let create_ix = create_account(
        &payer.pubkey(),
        &test_user.pubkey(),
        solana_rent::Rent::minimum_balance(&rent, 0),
        0,
        &solana_system_interface::program::ID,
    );

    let tx = Transaction::new_signed_with_payer(
        &[create_ix],
        Some(&payer.pubkey()),
        &[&payer, &test_user],
        svm.latest_blockhash(),
    );

    assert!(svm.send_transaction(tx).is_ok());

    let (pda, bump) = Pubkey::find_program_address(&[b"page_visits", test_user.pubkey().as_ref()], &program_id);

    let mut data = Vec::new();

    data.push(0);
    data.extend_from_slice(&u32::to_le_bytes(0));
    data.extend_from_slice(&u8::to_le_bytes(bump));

    dbg!(data.len());

    let ix = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(pda, false),
            AccountMeta::new(test_user.pubkey(), false),
            AccountMeta::new(payer.pubkey(), true),
            AccountMeta::new(solana_system_interface::program::ID, false),
        ],
        data,
    };

    let tx = Transaction::new_signed_with_payer(&[ix], Some(&payer.pubkey()), &[&payer], svm.latest_blockhash());

    let res = svm.send_transaction(tx);
    assert!(res.is_ok());

    let mut data = Vec::new();
    data.push(1);

    let ix = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(pda, false),
            // AccountMeta::new(payer.pubkey(), true),
        ],
        data,
    };

    let tx = Transaction::new_signed_with_payer(&[ix], Some(&payer.pubkey()), &[&payer], svm.latest_blockhash());

    let res = svm.send_transaction(tx);
    assert!(res.is_ok());

    // read page visits
    let account_info = svm.get_account(&pda).unwrap();
    let page_visits = u32::from_le_bytes(account_info.data[0..4].try_into().unwrap());
    assert_eq!(page_visits, 1);
}
