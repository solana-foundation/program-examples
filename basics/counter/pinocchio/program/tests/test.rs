use counter_solana_pinocchio::Counter;
use litesvm::LiteSVM;
use solana_instruction::{AccountMeta, Instruction};
use solana_keypair::{Keypair, Signer};
use solana_native_token::LAMPORTS_PER_SOL;
use solana_pubkey::Pubkey;
use solana_rent::Rent;
use solana_system_interface::instruction::create_account;
use solana_transaction::Transaction;

#[test]
fn test_counter() {
    let program_id = Pubkey::new_unique();
    let program_bytes = include_bytes!("../../tests/fixtures/counter_solana_pinocchio.so");

    let mut svm = LiteSVM::new();
    svm.add_program(program_id, program_bytes).unwrap();

    let payer = Keypair::new();
    let counter_account = Keypair::new();

    svm.airdrop(&payer.pubkey(), LAMPORTS_PER_SOL * 10).unwrap();

    let counter_account_size = std::mem::size_of::<Counter>();

    let create_ix = create_account(
        &payer.pubkey(),
        &counter_account.pubkey(),
        Rent::default().minimum_balance(counter_account_size),
        counter_account_size as u64,
        &program_id,
    );

    let tx = Transaction::new_signed_with_payer(
        &[create_ix],
        Some(&payer.pubkey()),
        &[&payer, &counter_account],
        svm.latest_blockhash(),
    );

    let res = svm.send_transaction(tx);
    assert!(res.is_ok());

    let ix =
        Instruction { program_id, accounts: vec![AccountMeta::new(counter_account.pubkey(), false)], data: vec![0] };

    let tx = Transaction::new_signed_with_payer(&[ix], Some(&payer.pubkey()), &[payer], svm.latest_blockhash());

    let res = svm.send_transaction(tx);
    assert!(res.is_ok());

    let counter_account_data = svm.get_account(&counter_account.pubkey()).unwrap().data;
    let counter_bytes: [u8; 8] = counter_account_data[0..8].try_into().unwrap();
    let count = u64::from_le_bytes(counter_bytes);
    assert_eq!(count, 1);
}
