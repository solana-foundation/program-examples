use borsh::BorshDeserialize;
use favorites_native::processor::{Favorites, FavoritesInstruction};
use litesvm::LiteSVM;
use solana_instruction::{AccountMeta, Instruction};
use solana_keypair::{Keypair, Signer};
use solana_native_token::LAMPORTS_PER_SOL;
use solana_pubkey::Pubkey;
use solana_transaction::Transaction;

#[test]
fn test_favorites() {
    let program_id = Pubkey::new_unique();
    let program_bytes = include_bytes!("../../tests/fixtures/favorites_native.so");

    let mut svm = LiteSVM::new();
    svm.add_program(program_id, program_bytes).unwrap();

    let payer = Keypair::new();

    svm.airdrop(&payer.pubkey(), LAMPORTS_PER_SOL * 10).unwrap();

    let favorites_pda = Pubkey::find_program_address(&[b"favorite", payer.pubkey().as_ref()], &program_id).0;

    let favorites = Favorites {
        number: 42,
        color: "blue".to_string(),
        hobbies: vec!["coding".to_string(), "reading".to_string(), "travelling".to_string()],
    };

    let data = borsh::to_vec(&FavoritesInstruction::CreatePda(favorites.clone())).unwrap();

    let ix = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(payer.pubkey(), true),
            AccountMeta::new(favorites_pda, false),
            AccountMeta::new(solana_system_interface::program::ID, false),
        ],
        data,
    };

    let tx = Transaction::new_signed_with_payer(&[ix], Some(&payer.pubkey()), &[&payer], svm.latest_blockhash());

    assert!(svm.send_transaction(tx).is_ok());

    let favorites_account_data = svm.get_account(&favorites_pda).unwrap().data;

    let deserialized_data = Favorites::try_from_slice(&favorites_account_data).unwrap();

    assert_eq!(deserialized_data.number, favorites.number);
    assert_eq!(deserialized_data.color, favorites.color);
    assert_eq!(deserialized_data.hobbies, favorites.hobbies);

    let data = borsh::to_vec(&FavoritesInstruction::GetPda).unwrap();

    let ix = Instruction {
        program_id,
        accounts: vec![AccountMeta::new(payer.pubkey(), true), AccountMeta::new(favorites_pda, false)],
        data,
    };

    let tx = Transaction::new_signed_with_payer(&[ix], Some(&payer.pubkey()), &[&payer], svm.latest_blockhash());

    assert!(svm.send_transaction(tx).is_ok());
}
