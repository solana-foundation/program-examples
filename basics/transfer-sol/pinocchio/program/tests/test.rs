use litesvm::LiteSVM;
use solana_instruction::{AccountMeta, Instruction};
use solana_instruction_error::InstructionError;
use solana_keypair::{Keypair, Signer};
use solana_native_token::LAMPORTS_PER_SOL;
use solana_pubkey::Pubkey;
use solana_system_interface::instruction::create_account;
use solana_transaction::Transaction;
use solana_transaction_error::TransactionError;
use transfer_sol_pinocchio_program::{CPI_TRANSFER_DISCRIMINATOR, PROGRAM_TRANSFER_DISCRIMINATOR};
#[test]
fn test_transfer_sol() {
    let mut svm = LiteSVM::new();

    let program_id = Pubkey::new_unique();
    let program_bytes = include_bytes!("../../tests/fixtures/transfer_sol_pinocchio_program.so");

    svm.add_program(program_id, program_bytes).unwrap();

    let payer = Keypair::new();
    svm.airdrop(&payer.pubkey(), LAMPORTS_PER_SOL * 10).unwrap();

    let test_recipient1 = Keypair::new();
    let test_recipient2 = Keypair::new();
    let test_recipient3 = Keypair::new();

    let payer_balance_before = svm.get_balance(&payer.pubkey()).unwrap();
    let recipient_balance_before = svm.get_balance(&test_recipient1.pubkey()).unwrap_or(0);

    let mut data = Vec::new();
    data.push(CPI_TRANSFER_DISCRIMINATOR);
    data.extend_from_slice(&LAMPORTS_PER_SOL.to_le_bytes());

    let ix = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(payer.pubkey(), true),
            AccountMeta::new(test_recipient1.pubkey(), false),
            AccountMeta::new(solana_system_interface::program::ID, false),
        ],
        data,
    };

    let tx = Transaction::new_signed_with_payer(&[ix], Some(&payer.pubkey()), &[&payer], svm.latest_blockhash());

    let res = svm.send_transaction(tx);
    assert!(res.is_ok());

    let payer_balance_after = svm.get_balance(&payer.pubkey()).unwrap();
    let recipient_balance_after = svm.get_balance(&test_recipient1.pubkey()).unwrap_or(0);

    assert!(payer_balance_before > payer_balance_after);
    assert!(recipient_balance_before < recipient_balance_after);

    let create_ix = create_account(&payer.pubkey(), &test_recipient2.pubkey(), 2 * LAMPORTS_PER_SOL, 0, &program_id);

    let tx = Transaction::new_signed_with_payer(
        &[create_ix],
        Some(&payer.pubkey()),
        &[&payer, &test_recipient2],
        svm.latest_blockhash(),
    );

    let res = svm.send_transaction(tx);
    assert!(res.is_ok());

    let mut data = Vec::new();
    data.push(PROGRAM_TRANSFER_DISCRIMINATOR);
    data.extend_from_slice(&LAMPORTS_PER_SOL.to_le_bytes());

    let ix = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(test_recipient2.pubkey(), true),
            AccountMeta::new(test_recipient3.pubkey(), false),
        ],
        data,
    };

    let tx = Transaction::new_signed_with_payer(
        &[ix],
        Some(&payer.pubkey()),
        &[&payer, &test_recipient2],
        svm.latest_blockhash(),
    );

    let res = svm.send_transaction(tx);
    assert!(res.is_ok());

    // An attacker cannot drain another user's program-owned account. Create
    // a fresh victim account genuinely owned by this program (unlike
    // test_recipient3 above, which is only credited lamports and therefore
    // stays System-Program-owned). The attacker never has the victim's
    // private key: they mark it as a non-signer in the instruction and
    // only sign with their own (unrelated) fee-payer key.
    let victim = Keypair::new();
    let attacker_recipient = Keypair::new();

    let create_victim_ix = create_account(&payer.pubkey(), &victim.pubkey(), 2 * LAMPORTS_PER_SOL, 0, &program_id);
    let tx = Transaction::new_signed_with_payer(
        &[create_victim_ix],
        Some(&payer.pubkey()),
        &[&payer, &victim],
        svm.latest_blockhash(),
    );
    let res = svm.send_transaction(tx);
    assert!(res.is_ok());

    let mut data = Vec::new();
    data.push(PROGRAM_TRANSFER_DISCRIMINATOR);
    data.extend_from_slice(&LAMPORTS_PER_SOL.to_le_bytes());

    let attack_ix = Instruction {
        program_id,
        accounts: vec![AccountMeta::new(victim.pubkey(), false), AccountMeta::new(attacker_recipient.pubkey(), false)],
        data,
    };

    let tx = Transaction::new_signed_with_payer(&[attack_ix], Some(&payer.pubkey()), &[&payer], svm.latest_blockhash());

    let res = svm.send_transaction(tx);
    let err = res.expect_err("expected the attacker transaction to fail").err;
    assert_eq!(
        err,
        TransactionError::InstructionError(0, InstructionError::MissingRequiredSignature),
        "expected the debit to be rejected for lacking the victim's signature"
    );
}
