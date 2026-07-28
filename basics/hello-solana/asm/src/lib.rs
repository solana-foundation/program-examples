#[cfg(test)]
mod tests {
    use litesvm::LiteSVM;
    use solana_instruction::{AccountMeta, Instruction};
    use solana_keypair::{Keypair, Signer};
    use solana_native_token::LAMPORTS_PER_SOL;
    use solana_pubkey::Pubkey;
    use solana_transaction::Transaction;

    #[test]
    fn test_hello_solana() {
        let program_id = Pubkey::new_unique();
        let program_bytes = include_bytes!("../tests/fixtures/hello-solana-asm-program.so");

        let mut svm = LiteSVM::new();
        svm.add_program(program_id, program_bytes).unwrap();

        let payer = Keypair::new();

        svm.airdrop(&payer.pubkey(), LAMPORTS_PER_SOL * 10).unwrap();

        let ix = Instruction { program_id, accounts: vec![AccountMeta::new(payer.pubkey(), true)], data: vec![0] };

        let tx = Transaction::new_signed_with_payer(&[ix], Some(&payer.pubkey()), &[&payer], svm.latest_blockhash());

        let res = svm.send_transaction(tx);
        assert!(res.is_ok());

        let logs = &res.unwrap().logs;

        assert!(logs[0].starts_with("Program 11157t3sqMV725NVRLrVQbAu98Jjfk1uCKehJnXXQs"));
        assert_eq!(logs[1], "Program log: Hello, Solana!");
    }
}
