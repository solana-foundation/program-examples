use litesvm::LiteSVM;
use solana_account::Account;
use solana_address::Address;
use solana_instruction::{AccountMeta, Instruction};
use solana_keypair::Keypair;
use solana_native_token::LAMPORTS_PER_SOL;
use solana_signer::Signer;
use solana_transaction::Transaction;

const IX_AGGREGATE_VERIFY: u8 = 0;
const IX_ADD_SIGNERS: u8 = 1;
const IX_VERIFY: u8 = 2;

const G2_POINT: usize = 128;
const COUNT_PREFIX: usize = 2;

// BLS-over-BN254 test vectors (message "approve proposal #42", secrets 1, 2, 3),
// taken from the crypto-primitives reference implementation.
const PUBKEY_1: &str = "198e9393920d483a7260bfb731fb5d25f1aa493335a9e71297e485b7aef312c21800deef121f1e76426a00665e5c4479674322d4f75edadd46debd5cd992f6ed090689d0585ff075ec9e99ad690c3395bc4b313370b38ef355acdadcd122975b12c85ea5db8c6deb4aab71808dcb408fe3d1e7690c43d37b4ce6cc0166fa7daa";
const PUBKEY_2: &str = "203e205db4f19b37b60121b83a7333706db86431c6d835849957ed8c3928ad7927dc7234fd11d3e8c36c59277c3e6f149d5cd3cfa9a62aee49f8130962b4b3b9195e8aa5b7827463722b8c153931579d3505566b4edf48d498e185f0509de15204bb53b8977e5f92a0bc372742c4830944a59b4fe6b1c0466e2a6dad122b5d2e";
const PUBKEY_3: &str = "1014772f57bb9742735191cd5dcfe4ebbc04156b6878a0a7c9824f32ffb66e8506064e784db10e9051e52826e192715e8d7e478cb09a5e0012defa0694fbc7f5021e2335f3354bb7922ffcc2f38d3323dd9453ac49b55441452aeaca147711b2058e1d5681b5b9e0074b0f9c8d2c68a069b920d74521e79765036d57666c5597";
const NEGATED_MESSAGE_HASH: &str = "093cccf0e7508f50d86197799d553d23be9a52fecf9fa7d309f3f6a6a0bae1dd25592fd60d368265921cb7232eec3492210e46b4b95682469e7590b0d2df6f28";
const AGG_SIG_ALL: &str = "06a6497a71f97597f1acf925b1f67eca5b5dd8011f7140e08f484e57dc79bff61b8268216fa30b6505352cdde4fc0d71a005296166f81bfe8edbde2352a6abbf";
const AGG_SIG_FIRST_TWO: &str = "29da90779ff721fffa657af0a02eb50fcb18cc8176e4d63127827a1767d69c7e227c651364e066d84349de32d97fd6b7f423a1e2b9a162ba061337d5a29e9303";

fn from_hex(s: &str) -> Vec<u8> {
    (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect()
}

fn setup() -> (LiteSVM, Address, Keypair) {
    let program_id = Address::new_unique();
    let program_bytes = include_bytes!("../../tests/fixtures/bls_multisig_pinocchio_program.so");

    let mut svm = LiteSVM::new();
    svm.add_program(program_id, program_bytes).unwrap();

    let payer = Keypair::new();
    svm.airdrop(&payer.pubkey(), LAMPORTS_PER_SOL).unwrap();
    (svm, program_id, payer)
}

fn multisig_account(svm: &mut LiteSVM, owner: Address, capacity: usize, members: &[&str]) -> Address {
    let key = Address::new_unique();
    let mut data = vec![0u8; COUNT_PREFIX + capacity * G2_POINT];
    data[..COUNT_PREFIX].copy_from_slice(&(members.len() as u16).to_le_bytes());
    for (i, member) in members.iter().enumerate() {
        let start = COUNT_PREFIX + i * G2_POINT;
        data[start..start + G2_POINT].copy_from_slice(&from_hex(member));
    }
    svm.set_account(key, Account { lamports: 1_000_000_000, data, owner, ..Account::default() }).unwrap();
    key
}

fn send(
    svm: &mut LiteSVM,
    program_id: Address,
    payer: &Keypair,
    data: Vec<u8>,
    accounts: Vec<AccountMeta>,
) -> Result<Vec<u8>, String> {
    let ix = Instruction::new_with_bytes(program_id, &data, accounts);
    let tx = Transaction::new_signed_with_payer(&[ix], Some(&payer.pubkey()), &[payer], svm.latest_blockhash());
    match svm.send_transaction(tx) {
        Ok(meta) => Ok(meta.return_data.data),
        Err(failed) => Err(failed.err.to_string()),
    }
}

fn verify_data(discriminator: u8, agg_sig: &str) -> Vec<u8> {
    let mut data = vec![discriminator];
    data.extend_from_slice(&from_hex(agg_sig));
    data.extend_from_slice(&from_hex(NEGATED_MESSAGE_HASH));
    data
}

#[test]
fn stateless_aggregate_of_all_signers_verifies() {
    let (mut svm, program_id, payer) = setup();

    let mut data = verify_data(IX_AGGREGATE_VERIFY, AGG_SIG_ALL);
    for pubkey in [PUBKEY_1, PUBKEY_2, PUBKEY_3] {
        data.extend_from_slice(&from_hex(pubkey));
    }

    send(&mut svm, program_id, &payer, data, vec![]).unwrap();
}

#[test]
fn stateless_partial_aggregate_is_rejected() {
    let (mut svm, program_id, payer) = setup();

    let mut data = verify_data(IX_AGGREGATE_VERIFY, AGG_SIG_FIRST_TWO);
    for pubkey in [PUBKEY_1, PUBKEY_2, PUBKEY_3] {
        data.extend_from_slice(&from_hex(pubkey));
    }

    let err = send(&mut svm, program_id, &payer, data, vec![]).unwrap_err();
    assert!(err.contains("custom program error: 0x3"), "unexpected error: {err}");
}

#[test]
fn add_signers_appends_to_account() {
    let (mut svm, program_id, payer) = setup();
    let multisig = multisig_account(&mut svm, program_id, 3, &[]);

    let mut data = vec![IX_ADD_SIGNERS];
    for pubkey in [PUBKEY_1, PUBKEY_2, PUBKEY_3] {
        data.extend_from_slice(&from_hex(pubkey));
    }
    send(&mut svm, program_id, &payer, data, vec![AccountMeta::new(multisig, false)]).unwrap();

    let mut expected = (3u16).to_le_bytes().to_vec();
    for pubkey in [PUBKEY_1, PUBKEY_2, PUBKEY_3] {
        expected.extend_from_slice(&from_hex(pubkey));
    }
    assert_eq!(svm.get_account(&multisig).unwrap().data, expected);
}

#[test]
fn add_signers_beyond_capacity_is_rejected() {
    let (mut svm, program_id, payer) = setup();
    let multisig = multisig_account(&mut svm, program_id, 2, &[]);

    let mut data = vec![IX_ADD_SIGNERS];
    for pubkey in [PUBKEY_1, PUBKEY_2, PUBKEY_3] {
        data.extend_from_slice(&from_hex(pubkey));
    }
    let err = send(&mut svm, program_id, &payer, data, vec![AccountMeta::new(multisig, false)]).unwrap_err();
    assert!(err.contains("custom program error: 0x5"), "unexpected error: {err}");
}

#[test]
fn verify_all_signers_succeeds() {
    let (mut svm, program_id, payer) = setup();
    let multisig = multisig_account(&mut svm, program_id, 3, &[PUBKEY_1, PUBKEY_2, PUBKEY_3]);

    let data = verify_data(IX_VERIFY, AGG_SIG_ALL);
    send(&mut svm, program_id, &payer, data, vec![AccountMeta::new(multisig, false)]).unwrap();
}

#[test]
fn verify_with_missing_signer_is_rejected() {
    let (mut svm, program_id, payer) = setup();
    let multisig = multisig_account(&mut svm, program_id, 3, &[PUBKEY_1, PUBKEY_2, PUBKEY_3]);

    let data = verify_data(IX_VERIFY, AGG_SIG_FIRST_TWO);
    let err = send(&mut svm, program_id, &payer, data, vec![AccountMeta::new(multisig, false)]).unwrap_err();
    assert!(err.contains("custom program error: 0x3"), "unexpected error: {err}");
}

#[test]
fn verify_rejects_foreign_account() {
    let (mut svm, program_id, payer) = setup();
    let foreign_owner = Address::new_unique();
    let multisig = multisig_account(&mut svm, foreign_owner, 3, &[PUBKEY_1, PUBKEY_2, PUBKEY_3]);

    let data = verify_data(IX_VERIFY, AGG_SIG_ALL);
    let err = send(&mut svm, program_id, &payer, data, vec![AccountMeta::new(multisig, false)]).unwrap_err();
    assert!(err.contains("custom program error: 0x4"), "unexpected error: {err}");
}
