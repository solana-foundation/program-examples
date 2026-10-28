use {
    anchor_lang::prelude::Pubkey,
    serde::Deserialize,
    serde_json::{json, Value},
    sha2::{Digest, Sha256},
    std::{env, fs, process, str::FromStr},
};

const ZERO_HASH: [u8; 32] = [0; 32];

#[derive(Deserialize)]
struct Snapshot {
    snapshot_height: u64,
    chain_id: String,
    entries: Vec<SnapshotEntry>,
}

#[derive(Default, Deserialize)]
#[serde(default)]
struct SnapshotEntry {
    source_address: String,
    solana_address: Value,
    amount: Value,
}

struct Claim<'a> {
    entry: &'a SnapshotEntry,
    address: &'a str,
    wallet: Pubkey,
    amount: u64,
}

fn sha256(bytes: &[u8]) -> [u8; 32] {
    Sha256::digest(bytes).into()
}

fn hash_pair(left: &[u8; 32], right: &[u8; 32]) -> [u8; 32] {
    sha256(&[left.as_slice(), right.as_slice()].concat())
}

fn leaf_bytes(wallet: &Pubkey, amount: u64) -> Vec<u8> {
    [wallet.as_ref(), &amount.to_le_bytes()].concat()
}

struct MerkleTree {
    levels: Vec<Vec<[u8; 32]>>,
}

impl MerkleTree {
    fn new(leaves: &[Vec<u8>]) -> Self {
        let mut levels = vec![leaves.iter().map(|leaf| sha256(leaf)).collect::<Vec<_>>()];
        while levels.last().unwrap().len() > 1 {
            let next = levels
                .last()
                .unwrap()
                .chunks(2)
                .map(|pair| hash_pair(&pair[0], pair.get(1).unwrap_or(&ZERO_HASH)))
                .collect();
            levels.push(next);
        }
        Self { levels }
    }

    fn root(&self) -> [u8; 32] {
        self.levels.last().unwrap()[0]
    }

    fn proof(&self, mut index: usize) -> Vec<u8> {
        let mut siblings = Vec::new();
        for level in &self.levels[..self.levels.len() - 1] {
            siblings.extend_from_slice(level.get(index ^ 1).unwrap_or(&ZERO_HASH));
            index /= 2;
        }
        siblings
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn parse_amount(amount: &Value) -> Result<u64, String> {
    match amount {
        Value::Number(number) => number.as_u64().ok_or(format!("invalid numeric amount: {number}")),
        Value::String(text) if !text.is_empty() && text.bytes().all(|byte| byte.is_ascii_digit()) => {
            text.parse().map_err(|_| format!("amount does not fit in a u64: {text}"))
        }
        other => Err(format!("invalid amount: {other}")),
    }
}

fn parse_claim(entry: &SnapshotEntry) -> Result<Claim<'_>, String> {
    let address = entry.solana_address.as_str().ok_or(format!("invalid solana_address: {}", entry.solana_address))?;
    let wallet = Pubkey::from_str(address).map_err(|error| format!("invalid solana_address {address}: {error}"))?;
    Ok(Claim { entry, address, wallet, amount: parse_amount(&entry.amount)? })
}

fn main() {
    let args: Vec<String> = env::args().skip(1).collect();
    let [snapshot_path, output_path] = args.as_slice() else {
        eprintln!("Usage: cargo run --example generate_merkle_tree -- <snapshot.json> <output.json>");
        process::exit(1);
    };

    let snapshot: Snapshot =
        serde_json::from_str(&fs::read_to_string(snapshot_path).expect("read snapshot")).expect("parse snapshot");
    println!("Processing snapshot from {}", snapshot.chain_id);
    println!("Snapshot height: {}", snapshot.snapshot_height);
    println!("Total entries: {}", snapshot.entries.len());

    let claims: Vec<Claim> = snapshot
        .entries
        .iter()
        .filter_map(|entry| {
            parse_claim(entry)
                .map_err(|error| eprintln!("Skipping invalid entry for {}: {error}", entry.source_address))
                .ok()
        })
        .collect();
    if claims.is_empty() {
        eprintln!("snapshot must contain at least one valid entry");
        process::exit(1);
    }

    let leaves: Vec<_> = claims.iter().map(|claim| leaf_bytes(&claim.wallet, claim.amount)).collect();
    let tree = MerkleTree::new(&leaves);
    let root = tree.root();
    println!("\nMerkle root: 0x{}", hex(&root));

    let total_amount: u128 = claims.iter().map(|claim| u128::from(claim.amount)).sum();
    let proofs: Vec<Value> = claims
        .iter()
        .enumerate()
        .map(|(index, claim)| {
            json!({
                "solana_address": claim.address,
                "source_address": claim.entry.source_address,
                "amount": claim.amount.to_string(),
                "index": index,
                "proof": hex(&tree.proof(index)),
            })
        })
        .collect();
    let output = json!({
        "merkle_root": root,
        "merkle_root_hex": hex(&root),
        "total_amount": total_amount.to_string(),
        "total_entries": claims.len(),
        "snapshot_height": snapshot.snapshot_height,
        "proofs": proofs,
    });

    fs::write(output_path, serde_json::to_string_pretty(&output).unwrap()).expect("write output");
    println!("\nOutput written to: {output_path}");
    println!("Total claimable amount: {total_amount}");
}
