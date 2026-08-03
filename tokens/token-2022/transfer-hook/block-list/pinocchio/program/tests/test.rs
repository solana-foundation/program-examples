use litesvm::LiteSVM;
use solana_instruction::{AccountMeta, Instruction};
use solana_keypair::{Keypair, Signer};
use solana_native_token::LAMPORTS_PER_SOL;
use solana_pubkey::Pubkey;
use solana_transaction::Transaction;

const PROGRAM_ID: Pubkey = Pubkey::from_str_const("BLoCKLSG2qMQ9YxEyrrKKAQzthvW4Lu8Eyv74axF6mf");

const INIT: u8 = 0xF1;
const BLOCK_WALLET: u8 = 0xF2;
const UNBLOCK_WALLET: u8 = 0xF3;

const CONFIG_LEN: usize = 1 + 32 + 8;
const WALLET_BLOCK_LEN: usize = 1 + 32;

fn setup() -> (LiteSVM, Keypair) {
    let mut svm = LiteSVM::new();
    let program_bytes = include_bytes!("../../tests/fixtures/block_list.so");
    svm.add_program(PROGRAM_ID, program_bytes).unwrap();

    let authority = Keypair::new();
    svm.airdrop(&authority.pubkey(), LAMPORTS_PER_SOL * 10).unwrap();
    (svm, authority)
}

fn config_pda() -> Pubkey {
    Pubkey::find_program_address(&[b"config"], &PROGRAM_ID).0
}

fn wallet_block_pda(wallet: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"wallet_block", wallet.as_ref()], &PROGRAM_ID).0
}

fn send(svm: &mut LiteSVM, authority: &Keypair, ix: Instruction) {
    let tx = Transaction::new_signed_with_payer(&[ix], Some(&authority.pubkey()), &[authority], svm.latest_blockhash());
    svm.send_transaction(tx).unwrap();
}

fn init_ix(authority: &Pubkey) -> Instruction {
    Instruction {
        program_id: PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(*authority, true),
            AccountMeta::new(config_pda(), false),
            AccountMeta::new_readonly(solana_system_interface::program::ID, false),
        ],
        data: vec![INIT],
    }
}

fn block_ix(authority: &Pubkey, wallet: &Pubkey) -> Instruction {
    Instruction {
        program_id: PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(*authority, true),
            AccountMeta::new(config_pda(), false),
            AccountMeta::new_readonly(*wallet, false),
            AccountMeta::new(wallet_block_pda(wallet), false),
            AccountMeta::new_readonly(solana_system_interface::program::ID, false),
        ],
        data: vec![BLOCK_WALLET],
    }
}

fn unblock_ix(authority: &Pubkey, wallet: &Pubkey) -> Instruction {
    Instruction {
        program_id: PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(*authority, true),
            AccountMeta::new(config_pda(), false),
            AccountMeta::new(wallet_block_pda(wallet), false),
            AccountMeta::new_readonly(solana_system_interface::program::ID, false),
        ],
        data: vec![UNBLOCK_WALLET],
    }
}

fn blocked_wallets_count(svm: &LiteSVM) -> u64 {
    let data = svm.get_account(&config_pda()).unwrap().data;
    u64::from_le_bytes(data[33..41].try_into().unwrap())
}

#[test]
fn init_creates_config_with_authority() {
    let (mut svm, authority) = setup();

    send(&mut svm, &authority, init_ix(&authority.pubkey()));

    let config = svm.get_account(&config_pda()).unwrap();
    assert_eq!(config.owner, PROGRAM_ID);
    assert_eq!(config.data.len(), CONFIG_LEN);
    assert_eq!(config.data[0], 0x01);
    assert_eq!(&config.data[1..33], authority.pubkey().as_ref());
    assert_eq!(blocked_wallets_count(&svm), 0);
}

#[test]
fn block_wallet_creates_block_and_increments_count() {
    let (mut svm, authority) = setup();
    let wallet = Pubkey::new_unique();

    send(&mut svm, &authority, init_ix(&authority.pubkey()));
    send(&mut svm, &authority, block_ix(&authority.pubkey(), &wallet));

    let wallet_block = svm.get_account(&wallet_block_pda(&wallet)).unwrap();
    assert_eq!(wallet_block.owner, PROGRAM_ID);
    assert_eq!(wallet_block.data.len(), WALLET_BLOCK_LEN);
    assert_eq!(wallet_block.data[0], 0x02);
    assert_eq!(&wallet_block.data[1..33], wallet.as_ref());
    assert_eq!(blocked_wallets_count(&svm), 1);
}

#[test]
fn unblock_wallet_closes_block_and_decrements_count() {
    let (mut svm, authority) = setup();
    let wallet = Pubkey::new_unique();

    send(&mut svm, &authority, init_ix(&authority.pubkey()));
    send(&mut svm, &authority, block_ix(&authority.pubkey(), &wallet));
    send(&mut svm, &authority, unblock_ix(&authority.pubkey(), &wallet));

    let closed = svm.get_account(&wallet_block_pda(&wallet));
    assert!(closed.is_none() || closed.unwrap().lamports == 0);
    assert_eq!(blocked_wallets_count(&svm), 0);
}

#[test]
fn non_authority_cannot_block_wallet() {
    let (mut svm, authority) = setup();
    let intruder = Keypair::new();
    svm.airdrop(&intruder.pubkey(), LAMPORTS_PER_SOL).unwrap();
    let wallet = Pubkey::new_unique();

    send(&mut svm, &authority, init_ix(&authority.pubkey()));

    let tx = Transaction::new_signed_with_payer(
        &[block_ix(&intruder.pubkey(), &wallet)],
        Some(&intruder.pubkey()),
        &[&intruder],
        svm.latest_blockhash(),
    );
    assert!(svm.send_transaction(tx).is_err());
    assert_eq!(blocked_wallets_count(&svm), 0);
}
