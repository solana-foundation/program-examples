use litesvm::LiteSVM;
use solana_account::Account;
use solana_address::Address;
use solana_instruction::{AccountMeta, Instruction};
use solana_keypair::Keypair;
use solana_native_token::LAMPORTS_PER_SOL;
use solana_signer::Signer;
use solana_transaction::Transaction;

const IX_ADD: u8 = 0;
const IX_REMOVE: u8 = 1;

const G2_POINT: usize = 192;
const COUNT_PREFIX: usize = 2;

// Big-endian BLS12-381 G2 keys and their running aggregates, taken from the
// crypto-primitives reference implementation.
const PUBKEY_1: &str = "13e02b6052719f607dacd3a088274f65596bd0d09920b61ab5da61bbdc7f5049334cf11213945d57e5ac7d055d042b7e024aa2b2f08f0a91260805272dc51051c6e47ad4fa403b02b4510b647ae3d1770bac0326a805bbefd48056c8c121bdb80606c4a02ea734cc32acd2b02bc28b99cb3e287e85a763af267492ab572e99ab3f370d275cec1da1aaa9075ff05f79be0ce5d527727d6e118cc9cdc6da2e351aadfd9baa8cbdd3a76d429a695160d12c923ac9cc3baca289e193548608b82801";
const PUBKEY_2: &str = "0a4edef9c1ed7f729f520e47730a124fd70662a904ba1074728114d1031e1572c6c886f6b57ec72a6178288c47c335771638533957d540a9d2370f17cc7ed5863bc0b995b8825e0ee1ea1e1e4d00dbae81f14b0bf3611b78c952aacab827a0530f6d4552fa65dd2638b361543f887136a43253d9c66c411697003f7a13c308f5422e1aa0a59c8967acdefd8b6e36ccf30468fb440d82b0630aeb8dca2b5256789a66da69bf91009cbfe6bd221e47aa8ae88dece9764bf3bd999d95d71e4c9899";
const PUBKEY_3: &str = "09380275bbc8e5dcea7dc4dd7e0550ff2ac480905396eda55062650f8d251c96eb480673937cc6d9d6a44aaa56ca66dc122915c824a0857e2ee414a3dccb23ae691ae54329781315a0c75df1c04d6d7a50a030fc866f09d516020ef82324afae08f239ba329b3967fe48d718a36cfe5f62a7e42e0bf1c1ed714150a166bfbd6bcf6b3b58b975b9edea56d53f23a0e8490b21da7955969e61010c7a1abc1a6f0136961d1e3b20b1a7326ac738fef5c721479dfd948b52fdf2455e44813ecfd892";
const AGG_1_2: &str = "09380275bbc8e5dcea7dc4dd7e0550ff2ac480905396eda55062650f8d251c96eb480673937cc6d9d6a44aaa56ca66dc122915c824a0857e2ee414a3dccb23ae691ae54329781315a0c75df1c04d6d7a50a030fc866f09d516020ef82324afae08f239ba329b3967fe48d718a36cfe5f62a7e42e0bf1c1ed714150a166bfbd6bcf6b3b58b975b9edea56d53f23a0e8490b21da7955969e61010c7a1abc1a6f0136961d1e3b20b1a7326ac738fef5c721479dfd948b52fdf2455e44813ecfd892";
const AGG_1_2_3: &str = "03f4b4e761936d90fd5f55f99087138a07a69755ad4a46e4dd1c2cfe6d11371e1cc033111a0595e3bba98d0f538db45119e384121b7d70927c49e6d044fd8517c36bc6ed2813a8956dd64f049869e8a77f7e46930240e6984abe26fa6a89658f088bb5832f4a4a452edda646ebaa2853a54205d56329960b44b2450070734724a74daaa401879bad142132316e9b340117a31a4fccfb5f768a2157517c77a4f8aaf0dee8f260d96e02e1175a8754d09600923beae02a019afc327b65a2fdbbfc";
const AGG_1_3: &str = "070227d3f13684fdb7ce31b8065ba3acb35f7bde6fe2ddfefa359f8b35d08a9ab9537b43e24f4ffb720b5a0bda2a82f20e7a30979a8853a077454eb63b8dcee75f106221b262886bb8e01b0abb043368da82f60899cc1412e33e4120195fc5570782c14e2c4ee61cbe7be6e462a66b2e3509f42d53ff333efc9bfe9a00307cd2f68b007606446d98a75fb808a405d8b90701377cb7da22789d032737eabcea2b2eee6bb4634c4365864511a43c2caad50422993ccd3e99636eb8a5f189454b18";

fn from_hex(s: &str) -> Vec<u8> {
    (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect()
}

fn setup() -> (LiteSVM, Address, Keypair) {
    let program_id = Address::new_unique();
    let program_bytes = include_bytes!("../../tests/fixtures/bls_key_registry_pinocchio_program.so");

    let mut svm = LiteSVM::new();
    svm.add_program(program_id, program_bytes).unwrap();

    let payer = Keypair::new();
    svm.airdrop(&payer.pubkey(), LAMPORTS_PER_SOL).unwrap();
    (svm, program_id, payer)
}

fn registry_account(svm: &mut LiteSVM, owner: Address, count: u16, aggregate: Option<&str>) -> Address {
    let key = Address::new_unique();
    let mut data = vec![0u8; COUNT_PREFIX + G2_POINT];
    data[..COUNT_PREFIX].copy_from_slice(&count.to_le_bytes());
    if let Some(aggregate) = aggregate {
        data[COUNT_PREFIX..].copy_from_slice(&from_hex(aggregate));
    }
    svm.set_account(key, Account { lamports: 1_000_000_000, data, owner, ..Account::default() }).unwrap();
    key
}

fn send(
    svm: &mut LiteSVM,
    program_id: Address,
    payer: &Keypair,
    discriminator: u8,
    pubkey: &str,
    registry: Address,
) -> Result<(), String> {
    let mut data = vec![discriminator];
    data.extend_from_slice(&from_hex(pubkey));
    let ix = Instruction::new_with_bytes(program_id, &data, vec![AccountMeta::new(registry, false)]);
    let tx = Transaction::new_signed_with_payer(&[ix], Some(&payer.pubkey()), &[payer], svm.latest_blockhash());
    match svm.send_transaction(tx) {
        Ok(_) => Ok(()),
        Err(failed) => Err(failed.err.to_string()),
    }
}

fn registry_data(count: u16, aggregate: &str) -> Vec<u8> {
    let mut expected = count.to_le_bytes().to_vec();
    expected.extend_from_slice(&from_hex(aggregate));
    expected
}

#[test]
fn add_first_member_stores_key_verbatim() {
    let (mut svm, program_id, payer) = setup();
    let registry = registry_account(&mut svm, program_id, 0, None);

    send(&mut svm, program_id, &payer, IX_ADD, PUBKEY_1, registry).unwrap();
    assert_eq!(svm.get_account(&registry).unwrap().data, registry_data(1, PUBKEY_1));
}

#[test]
fn add_folds_members_into_running_aggregate() {
    let (mut svm, program_id, payer) = setup();
    let registry = registry_account(&mut svm, program_id, 0, None);

    send(&mut svm, program_id, &payer, IX_ADD, PUBKEY_1, registry).unwrap();
    send(&mut svm, program_id, &payer, IX_ADD, PUBKEY_2, registry).unwrap();
    assert_eq!(svm.get_account(&registry).unwrap().data, registry_data(2, AGG_1_2));

    send(&mut svm, program_id, &payer, IX_ADD, PUBKEY_3, registry).unwrap();
    assert_eq!(svm.get_account(&registry).unwrap().data, registry_data(3, AGG_1_2_3));
}

#[test]
fn remove_subtracts_member_from_aggregate() {
    let (mut svm, program_id, payer) = setup();
    let registry = registry_account(&mut svm, program_id, 3, Some(AGG_1_2_3));

    send(&mut svm, program_id, &payer, IX_REMOVE, PUBKEY_2, registry).unwrap();
    assert_eq!(svm.get_account(&registry).unwrap().data, registry_data(2, AGG_1_3));
}

#[test]
fn remove_last_member_zeroes_aggregate() {
    let (mut svm, program_id, payer) = setup();
    let registry = registry_account(&mut svm, program_id, 1, Some(PUBKEY_1));

    send(&mut svm, program_id, &payer, IX_REMOVE, PUBKEY_1, registry).unwrap();
    assert_eq!(svm.get_account(&registry).unwrap().data, vec![0u8; COUNT_PREFIX + G2_POINT]);
}

#[test]
fn remove_from_empty_registry_is_rejected() {
    let (mut svm, program_id, payer) = setup();
    let registry = registry_account(&mut svm, program_id, 0, None);

    let err = send(&mut svm, program_id, &payer, IX_REMOVE, PUBKEY_1, registry).unwrap_err();
    assert!(err.contains("custom program error: 0x4"), "unexpected error: {err}");
}

#[test]
fn foreign_account_is_rejected() {
    let (mut svm, program_id, payer) = setup();
    let foreign_owner = Address::new_unique();
    let registry = registry_account(&mut svm, foreign_owner, 0, None);

    let err = send(&mut svm, program_id, &payer, IX_ADD, PUBKEY_1, registry).unwrap_err();
    assert!(err.contains("custom program error: 0x3"), "unexpected error: {err}");
}
