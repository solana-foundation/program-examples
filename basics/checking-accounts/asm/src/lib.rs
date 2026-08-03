#[cfg(test)]
mod tests {

    use litesvm::LiteSVM;
    use solana_instruction::error::InstructionError;
    use solana_keypair::{Keypair, Signer};
    use solana_native_token::LAMPORTS_PER_SOL;
    use solana_pubkey::Pubkey;
    use solana_system_interface::instruction::create_account;
    use solana_transaction::{AccountMeta, Instruction, Transaction};
    use solana_transaction_error::TransactionError;

    #[test]
    fn test_checking_accounts() {
        let mut svm = LiteSVM::new();

        let payer = Keypair::new();
        let account_to_change = Keypair::new();
        let account_to_create = Keypair::new();

        svm.airdrop(&payer.pubkey(), LAMPORTS_PER_SOL * 10).unwrap();

        let program_id = Pubkey::new_unique();
        let program_bytes = include_bytes!("../tests/fixtures/checking-account-asm-program.so");

        svm.add_program(program_id, program_bytes).unwrap();

        let create_account_ix =
            create_account(&payer.pubkey(), &account_to_change.pubkey(), LAMPORTS_PER_SOL, 0, &program_id);

        let tx = Transaction::new_signed_with_payer(
            &[create_account_ix],
            Some(&payer.pubkey()),
            &[&payer, &account_to_change],
            svm.latest_blockhash(),
        );

        // verify tx was sent successfully
        assert!(svm.send_transaction(tx).is_ok());

        let ix = Instruction {
            program_id,
            accounts: vec![
                AccountMeta::new(payer.pubkey(), true),
                AccountMeta::new(account_to_create.pubkey(), true),
                AccountMeta::new(account_to_change.pubkey(), true),
                AccountMeta::new(solana_system_interface::program::ID, false),
            ],
            data: vec![],
        };

        let tx = Transaction::new_signed_with_payer(
            &[ix],
            Some(&payer.pubkey()),
            &[payer, account_to_change, account_to_create],
            svm.latest_blockhash(),
        );

        // verify tx was sent successfully
        let res = svm.send_transaction(tx);
        assert!(res.is_ok());
    }

    fn setup() -> (LiteSVM, Pubkey) {
        let mut svm = LiteSVM::new();
        let program_id = Pubkey::new_unique();
        let program_bytes = include_bytes!("../tests/fixtures/checking-account-asm-program.so");
        svm.add_program(program_id, program_bytes).unwrap();
        (svm, program_id)
    }

    #[test]
    fn test_invalid_num_accounts() {
        let (mut svm, program_id) = setup();
        let payer = Keypair::new();
        svm.airdrop(&payer.pubkey(), LAMPORTS_PER_SOL * 10).unwrap();

        let ix = Instruction {
            program_id,
            accounts: vec![AccountMeta::new(payer.pubkey(), true)], // only 1 account
            data: vec![0],
        };

        let tx = Transaction::new_signed_with_payer(&[ix], Some(&payer.pubkey()), &[&payer], svm.latest_blockhash());

        let err = svm.send_transaction(tx).unwrap_err();
        assert_eq!(err.err, TransactionError::InstructionError(0, InstructionError::Custom(1)));
    }

    #[test]
    fn test_payer_not_signer() {
        let (mut svm, program_id) = setup();
        let fee_payer = Keypair::new();
        let payer = Keypair::new();
        let account_to_create = Keypair::new();
        let account_to_change = Keypair::new();

        svm.airdrop(&fee_payer.pubkey(), LAMPORTS_PER_SOL * 10).unwrap();
        svm.airdrop(&account_to_change.pubkey(), LAMPORTS_PER_SOL).unwrap();

        let ix = Instruction {
            program_id,
            accounts: vec![
                AccountMeta::new(payer.pubkey(), false), // not a signer
                AccountMeta::new(account_to_create.pubkey(), true),
                AccountMeta::new(account_to_change.pubkey(), true),
                AccountMeta::new(solana_system_interface::program::ID, false),
            ],
            data: vec![0],
        };

        let tx = Transaction::new_signed_with_payer(
            &[ix],
            Some(&fee_payer.pubkey()),
            &[&fee_payer, &account_to_create, &account_to_change],
            svm.latest_blockhash(),
        );

        let err = svm.send_transaction(tx).unwrap_err();
        assert_eq!(err.err, TransactionError::InstructionError(0, InstructionError::Custom(2)));
    }

    #[test]
    fn test_account_to_create_already_initialized() {
        let (mut svm, program_id) = setup();
        let payer = Keypair::new();
        let account_to_create = Keypair::new();
        let account_to_change = Keypair::new();

        svm.airdrop(&payer.pubkey(), LAMPORTS_PER_SOL * 10).unwrap();
        svm.airdrop(&account_to_create.pubkey(), LAMPORTS_PER_SOL).unwrap(); // already initialized

        svm.airdrop(&account_to_change.pubkey(), LAMPORTS_PER_SOL).unwrap();

        let ix = Instruction {
            program_id,
            accounts: vec![
                AccountMeta::new(payer.pubkey(), true),
                AccountMeta::new(account_to_create.pubkey(), true),
                AccountMeta::new(account_to_change.pubkey(), true),
                AccountMeta::new(solana_system_interface::program::ID, false),
            ],
            data: vec![0],
        };

        let tx = Transaction::new_signed_with_payer(
            &[ix],
            Some(&payer.pubkey()),
            &[&payer, &account_to_create, &account_to_change],
            svm.latest_blockhash(),
        );

        let err = svm.send_transaction(tx).unwrap_err();
        assert_eq!(err.err, TransactionError::InstructionError(0, InstructionError::Custom(3)));
    }

    #[test]
    fn test_account_to_change_not_initialized() {
        let (mut svm, program_id) = setup();
        let payer = Keypair::new();
        let account_to_create = Keypair::new();
        let account_to_change = Keypair::new();

        svm.airdrop(&payer.pubkey(), LAMPORTS_PER_SOL * 10).unwrap();
        // account_to_change has 0 lamports

        let ix = Instruction {
            program_id,
            accounts: vec![
                AccountMeta::new(payer.pubkey(), true),
                AccountMeta::new(account_to_create.pubkey(), true),
                AccountMeta::new(account_to_change.pubkey(), true),
                AccountMeta::new(solana_system_interface::program::ID, false),
            ],
            data: vec![0],
        };

        let tx = Transaction::new_signed_with_payer(
            &[ix],
            Some(&payer.pubkey()),
            &[&payer, &account_to_create, &account_to_change],
            svm.latest_blockhash(),
        );

        let err = svm.send_transaction(tx).unwrap_err();
        assert_eq!(err.err, TransactionError::InstructionError(0, InstructionError::Custom(4)));
    }

    #[test]
    fn test_account_to_change_wrong_owner() {
        let (mut svm, program_id) = setup();
        let payer = Keypair::new();
        let account_to_create = Keypair::new();
        let account_to_change = Keypair::new();

        svm.airdrop(&payer.pubkey(), LAMPORTS_PER_SOL * 10).unwrap();
        svm.airdrop(&account_to_change.pubkey(), LAMPORTS_PER_SOL).unwrap(); // initialized, but still owned by the system program

        let ix = Instruction {
            program_id,
            accounts: vec![
                AccountMeta::new(payer.pubkey(), true),
                AccountMeta::new(account_to_create.pubkey(), true),
                AccountMeta::new(account_to_change.pubkey(), true),
                AccountMeta::new(solana_system_interface::program::ID, false),
            ],
            data: vec![0],
        };

        let tx = Transaction::new_signed_with_payer(
            &[ix],
            Some(&payer.pubkey()),
            &[&payer, &account_to_create, &account_to_change],
            svm.latest_blockhash(),
        );

        let err = svm.send_transaction(tx).unwrap_err();
        assert_eq!(err.err, TransactionError::InstructionError(0, InstructionError::Custom(6)));
    }

    #[test]
    fn test_invalid_system_program() {
        let (mut svm, program_id) = setup();
        let payer = Keypair::new();
        let account_to_create = Keypair::new();
        let account_to_change = Keypair::new();
        let fake_system_program = Pubkey::new_unique(); // not the real system program

        svm.airdrop(&payer.pubkey(), LAMPORTS_PER_SOL * 10).unwrap();
        svm.airdrop(&account_to_change.pubkey(), LAMPORTS_PER_SOL).unwrap();

        let ix = Instruction {
            program_id,
            accounts: vec![
                AccountMeta::new(payer.pubkey(), true),
                AccountMeta::new(account_to_create.pubkey(), true),
                AccountMeta::new(account_to_change.pubkey(), true),
                AccountMeta::new(fake_system_program, false), // wrong system program
            ],
            data: vec![0],
        };

        let tx = Transaction::new_signed_with_payer(
            &[ix],
            Some(&payer.pubkey()),
            &[&payer, &account_to_create, &account_to_change],
            svm.latest_blockhash(),
        );

        let err = svm.send_transaction(tx).unwrap_err();
        assert_eq!(err.err, TransactionError::InstructionError(0, InstructionError::Custom(5)));
    }
}
