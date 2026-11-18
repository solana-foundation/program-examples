use {
    anchor_lang::{
        error::ErrorCode,
        solana_program::{instruction::Instruction, system_instruction, system_program},
        InstructionData, ToAccountMetas,
    },
    litesvm::LiteSVM,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::{versioned::VersionedTransaction, InstructionError, TransactionError},
};

fn setup() -> (LiteSVM, Keypair) {
    let mut svm = LiteSVM::new();
    let bytes = include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/../../target/deploy/checking_account_program.so"));
    svm.add_program(checking_account_program::id(), bytes).unwrap();
    let payer = Keypair::new();
    svm.airdrop(&payer.pubkey(), 1_000_000_000).unwrap();
    (svm, payer)
}

fn send(svm: &mut LiteSVM, ix: Instruction, payer: &Keypair, signers: &[&Keypair]) -> Result<(), TransactionError> {
    let msg = Message::new_with_blockhash(&[ix], Some(&payer.pubkey()), &svm.latest_blockhash());
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), signers).unwrap();
    svm.send_transaction(tx).map(|_| ()).map_err(|failed| failed.err)
}

fn check_accounts_ix(payer: &Keypair, account_to_create: &Keypair, account_to_change: &Keypair) -> Instruction {
    Instruction::new_with_bytes(
        checking_account_program::id(),
        &checking_account_program::instruction::CheckAccounts {}.data(),
        checking_account_program::accounts::CheckingAccounts {
            payer: payer.pubkey(),
            account_to_create: account_to_create.pubkey(),
            account_to_change: account_to_change.pubkey(),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    )
}

#[test]
fn check_accounts() {
    let (mut svm, payer) = setup();
    let account_to_change = Keypair::new();
    let account_to_create = Keypair::new();

    let create = system_instruction::create_account(
        &payer.pubkey(),
        &account_to_change.pubkey(),
        svm.minimum_balance_for_rent_exemption(0),
        0,
        &checking_account_program::id(),
    );
    send(&mut svm, create, &payer, &[&payer, &account_to_change]).unwrap();
    assert_eq!(svm.get_account(&account_to_change.pubkey()).unwrap().owner, checking_account_program::id());

    let check = check_accounts_ix(&payer, &account_to_create, &account_to_change);
    send(&mut svm, check, &payer, &[&payer]).unwrap();
}

#[test]
fn rejects_an_account_the_program_does_not_own() {
    let (mut svm, payer) = setup();
    let account_to_create = Keypair::new();
    // Never created, so the runtime presents it as owned by the System Program:
    // exactly what `owner = id()` on account_to_change must refuse.
    let foreign_account = Keypair::new();

    let check = check_accounts_ix(&payer, &account_to_create, &foreign_account);
    let err = send(&mut svm, check, &payer, &[&payer]).unwrap_err();
    assert_eq!(err, TransactionError::InstructionError(0, InstructionError::Custom(ErrorCode::ConstraintOwner.into())));
}
