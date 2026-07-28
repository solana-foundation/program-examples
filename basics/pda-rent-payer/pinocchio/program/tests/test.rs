use litesvm::LiteSVM;
use solana_instruction::{AccountMeta, Instruction};
use solana_keypair::{Keypair, Signer};
use solana_native_token::LAMPORTS_PER_SOL;
use solana_pubkey::Pubkey;
use solana_transaction::Transaction;

#[test]
fn test_pda_rent_payer() {
    let program_id = Pubkey::new_unique();
    let program_bytes = include_bytes!("../../tests/fixtures/pda_rent_payer_pinocchio_program.so");

    let mut svm = LiteSVM::new();
    svm.add_program(program_id, program_bytes).unwrap();

    let payer = Keypair::new();
    svm.airdrop(&payer.pubkey(), LAMPORTS_PER_SOL * 10).unwrap();

    let (rent_value_pda, bump) = Pubkey::find_program_address(&[b"rent_vault"], &program_id);

    // init_rent_vault
    let mut data = Vec::new();
    data.push(0);
    data.push(bump);
    data.extend_from_slice(&u64::to_le_bytes(1000000000));

    let ix = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(rent_value_pda, false),
            AccountMeta::new(payer.pubkey(), true),
            AccountMeta::new(solana_system_interface::program::ID, false),
        ],
        data,
    };

    let tx = Transaction::new_signed_with_payer(&[ix], Some(&payer.pubkey()), &[&payer], svm.latest_blockhash());

    let res = svm.send_transaction(tx);
    assert!(res.is_ok());

    // create_new_account
    let new_account = Keypair::new();

    let mut data = vec![1];
    data.push(bump);

    let ix = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(new_account.pubkey(), true),
            AccountMeta::new(rent_value_pda, false),
            AccountMeta::new(solana_system_interface::program::ID, false),
        ],
        data,
    };

    let tx = Transaction::new_signed_with_payer(
        &[ix],
        Some(&payer.pubkey()),
        &[&payer, &new_account],
        svm.latest_blockhash(),
    );

    let res = svm.send_transaction(tx);
    assert!(res.is_ok());
}
