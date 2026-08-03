#[cfg(test)]
mod tests {
    use litesvm::LiteSVM;
    use solana_instruction::{AccountMeta, Instruction};
    use solana_keypair::{Keypair, Signer};
    use solana_native_token::LAMPORTS_PER_SOL;
    use solana_pubkey::Pubkey;
    use solana_transaction::Transaction;

    #[test]
    fn test_transfer_sol() {
        let mut svm = LiteSVM::new();

        let program_id = Pubkey::new_unique();
        let program_bytes = include_bytes!("../deploy/transfer-sol-cpi.so");

        svm.add_program(program_id, program_bytes).unwrap();

        let payer = Keypair::new();
        svm.airdrop(&payer.pubkey(), LAMPORTS_PER_SOL * 10).unwrap();

        let test_recipient1 = Keypair::new();

        let payer_balance_before = svm.get_balance(&payer.pubkey()).unwrap();
        let recipient_balance_before = svm.get_balance(&test_recipient1.pubkey()).unwrap_or(0);

        let mut data = Vec::new();
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
    }
}
