use litesvm::LiteSVM;
use solana_instruction::{AccountMeta, Instruction};
use solana_keypair::{Keypair, Signer};
use solana_native_token::LAMPORTS_PER_SOL;
use solana_pubkey::Pubkey;
use solana_transaction::Transaction;

#[test]
fn test_favorites() {
    let program_id = Pubkey::new_unique();
    let program_bytes = include_bytes!("../../tests/fixtures/favorites_pinocchio.so");

    let mut svm = LiteSVM::new();
    svm.add_program(program_id, program_bytes).unwrap();

    let payer = Keypair::new();

    svm.airdrop(&payer.pubkey(), LAMPORTS_PER_SOL * 10).unwrap();

    let (favorites_pda, favorites_bump) =
        Pubkey::find_program_address(&[b"favorite", payer.pubkey().as_ref()], &program_id);

    let mut data = Vec::new();

    data.push(1);
    data.push(favorites_bump);

    data.extend_from_slice(&u64::to_le_bytes(42));

    let mut color = [0u8; 8];
    let color_len = "blue".len().min(8);
    color[..color_len].copy_from_slice(b"blue");
    data.extend_from_slice(&color);

    let mut hobby1 = [0u8; 16];
    let hobby1_len = "coding".len().min(16);
    hobby1[..hobby1_len].copy_from_slice(b"coding");
    data.extend_from_slice(&hobby1);

    let mut hobby2 = [0u8; 16];
    let hobby2_len = "reading".len().min(16);
    hobby2[..hobby2_len].copy_from_slice(b"reading");
    data.extend_from_slice(&hobby2);

    let mut hobby3 = [0u8; 16];
    let hobby3_len = "travelling".len().min(16);
    hobby3[..hobby3_len].copy_from_slice(b"travelling");
    data.extend_from_slice(&hobby3);

    let mut hobby4 = [0u8; 16];
    let hobby4_len = "shitposting".len().min(16);
    hobby4[..hobby4_len].copy_from_slice(b"shitposting");
    data.extend_from_slice(&hobby4);

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

    let res = svm.send_transaction(tx);
    assert!(res.is_ok());

    let mut data = Vec::new();
    data.push(2);
    data.push(favorites_bump);

    let ix = Instruction {
        program_id,
        accounts: vec![AccountMeta::new(payer.pubkey(), true), AccountMeta::new(favorites_pda, false)],
        data,
    };

    let tx = Transaction::new_signed_with_payer(&[ix], Some(&payer.pubkey()), &[&payer], svm.latest_blockhash());

    let res = svm.send_transaction(tx);
    assert!(res.is_ok());
}
