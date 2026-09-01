//! Merkle proof verification.

use solana_sha256_hasher::hashv;

use crate::error::ClaimError;

/// Recomputes the root a `leaf` at `index` implies, given its sibling hashes
/// from the bottom of the tree upwards.
///
/// `index` doubles as the path: its low bit says whether the leaf sits left or
/// right of its sibling at each level, and it is shifted down as the walk goes
/// up.
pub fn compute_merkle_root(leaf: &[u8], hashes: &[u8], mut index: u64) -> Result<[u8; 32], ClaimError> {
    if !hashes.len().is_multiple_of(32) {
        return Err(ClaimError::InvalidProof);
    }

    let mut current = hashv(&[leaf]).to_bytes();

    for sibling in hashes.chunks_exact(32) {
        current =
            if index.is_multiple_of(2) { hashv(&[&current, sibling]) } else { hashv(&[sibling, &current]) }.to_bytes();
        index /= 2;
    }

    // Index bits beyond the proof depth are never authenticated by the loop
    // above; without this check the same proof would also open receipts at
    // `index + 2^depth`, `index + 2^(depth + 1)`, and so on.
    if index != 0 {
        return Err(ClaimError::InvalidProof);
    }

    Ok(current)
}
