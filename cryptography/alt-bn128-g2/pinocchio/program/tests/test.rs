use litesvm::LiteSVM;
use solana_address::Address;
use solana_instruction::Instruction;
use solana_keypair::Keypair;
use solana_native_token::LAMPORTS_PER_SOL;
use solana_signer::Signer;
use solana_transaction::Transaction;

const IX_G2_ADD: u8 = 0;
const IX_G2_MUL: u8 = 1;

// Big-endian alt_bn128 G2 points derived from the BN254 G2 generator:
// GENERATOR + 2*GENERATOR == 3*GENERATOR.
const G2_GENERATOR: &str = "198e9393920d483a7260bfb731fb5d25f1aa493335a9e71297e485b7aef312c21800deef121f1e76426a00665e5c4479674322d4f75edadd46debd5cd992f6ed090689d0585ff075ec9e99ad690c3395bc4b313370b38ef355acdadcd122975b12c85ea5db8c6deb4aab71808dcb408fe3d1e7690c43d37b4ce6cc0166fa7daa";
const G2_TWO_GENERATOR: &str = "203e205db4f19b37b60121b83a7333706db86431c6d835849957ed8c3928ad7927dc7234fd11d3e8c36c59277c3e6f149d5cd3cfa9a62aee49f8130962b4b3b9195e8aa5b7827463722b8c153931579d3505566b4edf48d498e185f0509de15204bb53b8977e5f92a0bc372742c4830944a59b4fe6b1c0466e2a6dad122b5d2e";
const G2_THREE_GENERATOR: &str = "1014772f57bb9742735191cd5dcfe4ebbc04156b6878a0a7c9824f32ffb66e8506064e784db10e9051e52826e192715e8d7e478cb09a5e0012defa0694fbc7f5021e2335f3354bb7922ffcc2f38d3323dd9453ac49b55441452aeaca147711b2058e1d5681b5b9e0074b0f9c8d2c68a069b920d74521e79765036d57666c5597";

fn from_hex(s: &str) -> Vec<u8> {
    (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect()
}

fn setup() -> (LiteSVM, Address, Keypair) {
    let program_id = Address::new_unique();
    let program_bytes = include_bytes!("../../tests/fixtures/alt_bn128_g2_pinocchio_program.so");

    let mut svm = LiteSVM::new();
    svm.add_program(program_id, program_bytes).unwrap();

    let payer = Keypair::new();
    svm.airdrop(&payer.pubkey(), LAMPORTS_PER_SOL).unwrap();
    (svm, program_id, payer)
}

fn send(svm: &mut LiteSVM, program_id: Address, payer: &Keypair, data: Vec<u8>) -> Result<Vec<u8>, String> {
    let ix = Instruction::new_with_bytes(program_id, &data, vec![]);
    let tx = Transaction::new_signed_with_payer(&[ix], Some(&payer.pubkey()), &[payer], svm.latest_blockhash());
    match svm.send_transaction(tx) {
        Ok(meta) => Ok(meta.return_data.data),
        Err(failed) => Err(failed.err.to_string()),
    }
}

#[test]
fn g2_add_generator_plus_double_is_triple() {
    let (mut svm, program_id, payer) = setup();

    let mut data = vec![IX_G2_ADD];
    data.extend_from_slice(&from_hex(G2_GENERATOR));
    data.extend_from_slice(&from_hex(G2_TWO_GENERATOR));

    let return_data = send(&mut svm, program_id, &payer, data).unwrap();
    assert_eq!(return_data, from_hex(G2_THREE_GENERATOR));
}

#[test]
fn g2_mul_generator_times_three_is_triple() {
    let (mut svm, program_id, payer) = setup();

    let mut data = vec![IX_G2_MUL];
    data.extend_from_slice(&from_hex(G2_GENERATOR));
    let mut scalar = [0u8; 32];
    scalar[31] = 3;
    data.extend_from_slice(&scalar);

    let return_data = send(&mut svm, program_id, &payer, data).unwrap();
    assert_eq!(return_data, from_hex(G2_THREE_GENERATOR));
}

#[test]
fn wrong_input_length_is_rejected() {
    let (mut svm, program_id, payer) = setup();

    let err = send(&mut svm, program_id, &payer, vec![IX_G2_ADD, 0, 1, 2]).unwrap_err();
    assert!(err.contains("custom program error: 0x0"), "unexpected error: {err}");
}
