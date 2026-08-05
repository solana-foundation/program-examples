use litesvm::LiteSVM;
use solana_instruction::{AccountMeta, Instruction};
use solana_instruction_error::InstructionError;
use solana_keypair::{Keypair, Signer};
use solana_native_token::LAMPORTS_PER_SOL;
use solana_pubkey::Pubkey;
use solana_transaction::Transaction;
use solana_transaction_error::TransactionError;

use close_account_pinocchio_program::{User, CLOSE_DISCRIMINATOR, CREATE_DISCRIMINATOR};

#[test]
fn test_close_account() {
    let mut svm = LiteSVM::new();

    let program_id = Pubkey::new_unique();
    let program_bytes = include_bytes!("../../tests/fixtures/close_account_pinocchio_program.so");

    svm.add_program(program_id, program_bytes).unwrap();

    let payer = Keypair::new();
    svm.airdrop(&payer.pubkey(), LAMPORTS_PER_SOL * 10).unwrap();

    let test_account_pubkey =
        Pubkey::find_program_address(&[b"USER".as_ref(), &payer.pubkey().as_ref()], &program_id).0;

    let bump = Pubkey::find_program_address(&[User::SEED_PREFIX.as_bytes(), payer.pubkey().as_ref()], &program_id).1;

    // process_user
    let mut data = Vec::new();
    data.push(CREATE_DISCRIMINATOR);
    data.push(bump);
    let mut name = [0u8; User::LEN];
    let name_len = b"Jacob".len().min(User::LEN);
    name[..name_len].copy_from_slice(&b"Jacob"[..name_len]);
    data.extend_from_slice(&name);

    let ix = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(test_account_pubkey, false),
            AccountMeta::new(payer.pubkey(), true),
            AccountMeta::new(solana_system_interface::program::ID, false),
        ],
        data,
    };

    let tx = Transaction::new_signed_with_payer(&[ix], Some(&payer.pubkey()), &[&payer], svm.latest_blockhash());

    let res = svm.send_transaction(tx);
    assert!(res.is_ok());

    let account = svm.get_account(&test_account_pubkey).unwrap();
    assert_eq!(account.data.len(), User::LEN);
    assert_eq!(account.owner, program_id);
    assert_eq!(&account.data[..5], b"Jacob");

    // An attacker cannot close another user's account: the attacker signs
    // with their own key, but passes the victim's User PDA as the account
    // to close. Without a check that the target PDA actually belongs to the
    // signer, this would drain the victim's account into the attacker's.
    let attacker = Keypair::new();
    svm.airdrop(&attacker.pubkey(), LAMPORTS_PER_SOL).unwrap();

    let mut data = Vec::new();
    data.push(CLOSE_DISCRIMINATOR);

    let attack_ix = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(test_account_pubkey, false),
            AccountMeta::new(attacker.pubkey(), true),
            AccountMeta::new(solana_system_interface::program::ID, false),
        ],
        data,
    };

    let tx = Transaction::new_signed_with_payer(
        &[attack_ix],
        Some(&attacker.pubkey()),
        &[&attacker],
        svm.latest_blockhash(),
    );

    let res = svm.send_transaction(tx);
    let err = res.expect_err("expected the attacker transaction to fail").err;
    assert_eq!(
        err,
        TransactionError::InstructionError(0, InstructionError::IncorrectProgramId),
        "expected the attacker's target PDA to be rejected as not belonging to them"
    );

    // process_close
    let mut data = Vec::new();
    data.push(CLOSE_DISCRIMINATOR);

    let ix = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(test_account_pubkey, false),
            AccountMeta::new(payer.pubkey(), true),
            AccountMeta::new(solana_system_interface::program::ID, false),
        ],
        data,
    };

    let tx = Transaction::new_signed_with_payer(&[ix], Some(&payer.pubkey()), &[&payer], svm.latest_blockhash());

    let res = svm.send_transaction(tx);
    assert!(res.is_ok());

    let account = svm.get_account(&test_account_pubkey).unwrap();
    assert_eq!(account.data.len(), 0);
    assert_eq!(account.owner, solana_system_interface::program::ID);
}
