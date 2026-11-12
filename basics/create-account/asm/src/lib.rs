#[cfg(test)]
mod tests {

    use litesvm::LiteSVM;
    use solana_instruction::{AccountMeta, Instruction};
    use solana_keypair::{Keypair, Signer};
    use solana_native_token::LAMPORTS_PER_SOL;
    use solana_pubkey::Pubkey;
    use solana_transaction::Transaction;

    #[test]
    fn test_create_account() {
        let program_id = Pubkey::new_unique();
        let program_bytes = include_bytes!("../tests/fixtures/create-account-asm-program.so");

        let payer = Keypair::new();
        let new_keypair = Keypair::new();

        let mut svm = LiteSVM::new();
        svm.add_program(program_id, program_bytes).unwrap();
        svm.airdrop(&payer.pubkey(), LAMPORTS_PER_SOL * 10).unwrap();

        let ix = Instruction {
            program_id,
            accounts: vec![
                AccountMeta::new(payer.pubkey(), true),
                AccountMeta::new(new_keypair.pubkey(), true),
                AccountMeta::new(solana_system_interface::program::ID, false),
            ],
            data: vec![0],
        };

        let tx = Transaction::new_signed_with_payer(
            &[ix],
            Some(&payer.pubkey()),
            &[&payer, &new_keypair],
            svm.latest_blockhash(),
        );

        let res = svm.send_transaction(tx);
        assert!(res.is_ok());

        assert!(svm.get_account(&new_keypair.pubkey()).is_some());
    }
}
