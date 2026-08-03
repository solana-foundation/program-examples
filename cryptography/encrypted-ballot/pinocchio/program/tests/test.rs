use litesvm::LiteSVM;
use solana_account::Account;
use solana_address::Address;
use solana_instruction::{AccountMeta, Instruction};
use solana_keypair::Keypair;
use solana_native_token::LAMPORTS_PER_SOL;
use solana_signer::Signer;
use solana_transaction::Transaction;

const IX_TALLY_ADD: u8 = 0;

const CIPHERTEXT: usize = 64;
const COUNT_PREFIX: usize = 2;

// Deterministic ristretto255 basepoint multiples summed with @noble/curves:
// BALLOT_A = [2G || 3G], BALLOT_B = [5G || 7G], SUM = [7G || 10G].
const BALLOT_A: &str = "6a493210f7499cd17fecb510ae0cea23a110e8d5b901f8acadd3095c73a3b91994741f5d5d52755ece4f23f044ee27d5d1ea1e2bd196b462166b16152a9d0259";
const BALLOT_B: &str = "e882b131016b52c1d3337080187cf768423efccbb517bb495ab812c4160ff44e44f53520926ec81fbd5a387845beb7df85a96a24ece18738bdcfa6a7822a176d";
const SUM_AB: &str = "44f53520926ec81fbd5a387845beb7df85a96a24ece18738bdcfa6a7822a176d20706fd788b2720a1ed2a5dad4952b01f413bcf0e7564de8cdc816689e2db95f";

fn from_hex(s: &str) -> Vec<u8> {
    (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect()
}

fn setup() -> (LiteSVM, Address, Keypair) {
    let program_id = Address::new_unique();
    let program_bytes = include_bytes!("../../tests/fixtures/encrypted_ballot_pinocchio_program.so");

    let mut svm = LiteSVM::new();
    svm.add_program(program_id, program_bytes).unwrap();

    let payer = Keypair::new();
    svm.airdrop(&payer.pubkey(), LAMPORTS_PER_SOL).unwrap();
    (svm, program_id, payer)
}

fn tally_account(svm: &mut LiteSVM, owner: Address, count: u16, tally: Option<&str>) -> Address {
    let key = Address::new_unique();
    let mut data = vec![0u8; COUNT_PREFIX + CIPHERTEXT];
    data[..COUNT_PREFIX].copy_from_slice(&count.to_le_bytes());
    if let Some(tally) = tally {
        data[COUNT_PREFIX..].copy_from_slice(&from_hex(tally));
    }
    svm.set_account(key, Account { lamports: 1_000_000_000, data, owner, ..Account::default() }).unwrap();
    key
}

fn send(svm: &mut LiteSVM, program_id: Address, payer: &Keypair, ballot: &[u8], tally: Address) -> Result<(), String> {
    let mut data = vec![IX_TALLY_ADD];
    data.extend_from_slice(ballot);
    let ix = Instruction::new_with_bytes(program_id, &data, vec![AccountMeta::new(tally, false)]);
    let tx = Transaction::new_signed_with_payer(&[ix], Some(&payer.pubkey()), &[payer], svm.latest_blockhash());
    match svm.send_transaction(tx) {
        Ok(_) => Ok(()),
        Err(failed) => Err(failed.err.to_string()),
    }
}

#[test]
fn first_ballot_becomes_the_tally() {
    let (mut svm, program_id, payer) = setup();
    let tally = tally_account(&mut svm, program_id, 0, None);

    send(&mut svm, program_id, &payer, &from_hex(BALLOT_A), tally).unwrap();

    let mut expected = (1u16).to_le_bytes().to_vec();
    expected.extend_from_slice(&from_hex(BALLOT_A));
    assert_eq!(svm.get_account(&tally).unwrap().data, expected);
}

#[test]
fn second_ballot_folds_into_the_tally() {
    let (mut svm, program_id, payer) = setup();
    let tally = tally_account(&mut svm, program_id, 1, Some(BALLOT_A));

    send(&mut svm, program_id, &payer, &from_hex(BALLOT_B), tally).unwrap();

    let mut expected = (2u16).to_le_bytes().to_vec();
    expected.extend_from_slice(&from_hex(SUM_AB));
    assert_eq!(svm.get_account(&tally).unwrap().data, expected);
}

#[test]
fn wrong_ciphertext_length_is_rejected() {
    let (mut svm, program_id, payer) = setup();
    let tally = tally_account(&mut svm, program_id, 0, None);

    let err = send(&mut svm, program_id, &payer, &[0, 1, 2], tally).unwrap_err();
    assert!(err.contains("custom program error: 0x0"), "unexpected error: {err}");
}

#[test]
fn foreign_account_is_rejected() {
    let (mut svm, program_id, payer) = setup();
    let foreign_owner = Address::new_unique();
    let tally = tally_account(&mut svm, foreign_owner, 0, None);

    let err = send(&mut svm, program_id, &payer, &from_hex(BALLOT_A), tally).unwrap_err();
    assert!(err.contains("custom program error: 0x3"), "unexpected error: {err}");
}
