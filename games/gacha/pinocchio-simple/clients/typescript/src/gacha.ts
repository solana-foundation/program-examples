import { generateKeyPair, proveVRF, publicKeyFromSeed, verifyVRF, vrfProofToHash } from '@collectorcrypt/ecvrf';
import { sha256 } from '@noble/hashes/sha2.js';
import { type Address, getAddressEncoder } from '@solana/kit';

import { MAX_TIERS, RARITY_LABELS } from './constants.js';

/**
 * The VRF input for a pull: `SHA-256(pull_address || client_seed)`.
 *
 * Byte-for-byte mirror of the on-chain `derive_alpha`. Binding the buyer's
 * `clientSeed` (32 random bytes generated client-side at buy time) makes alpha
 * unpredictable to the operator before the buy lands — a fixed alpha alone
 * would let the operator precompute every outcome. Verifiers recompute this
 * from the `PullRequestedEvent` (or the pull account) to confirm the operator
 * did not choose the VRF input.
 */
export function pullAlpha(pull: Address, clientSeed: Uint8Array): Uint8Array {
    return pullAlphaBytes(new Uint8Array(getAddressEncoder().encode(pull)), clientSeed);
}

/**
 * Same as {@link pullAlpha}, taking the pull address as raw bytes — the form it
 * appears in (hex) in the prize NFT's metadata.
 */
export function pullAlphaBytes(pullBytes: Uint8Array, clientSeed: Uint8Array): Uint8Array {
    const input = new Uint8Array(pullBytes.length + clientSeed.length);
    input.set(pullBytes, 0);
    input.set(clientSeed, pullBytes.length);
    return sha256(input);
}

/**
 * Selects a reward tier from a VRF output, weighted by the pool's fixed tier
 * weights.
 *
 * Byte-for-byte mirror of the on-chain `select_tier`: the first 16 bytes of `beta`
 * are read as a little-endian u128 and reduced modulo the total weight, then the
 * target walks the tiers in order. Weights are fixed at pool init, so every pull
 * faces identical odds regardless of settle order. Throws when the total weight
 * is zero.
 */
export function selectTier(beta: Uint8Array, weights: readonly number[], tierCount: number): number {
    const count = Math.min(tierCount, MAX_TIERS);

    let total = 0n;
    for (let i = 0; i < count; i++) {
        total += BigInt(weights[i] ?? 0);
    }
    if (total === 0n) {
        throw new Error('invalid tier config: total weight is zero');
    }

    let seed = 0n;
    for (let i = 0; i < 16; i++) {
        seed |= BigInt(beta[i] ?? 0) << BigInt(8 * i);
    }
    let target = seed % total;

    for (let i = 0; i < count; i++) {
        const weight = BigInt(weights[i] ?? 0);
        if (target < weight) {
            return i;
        }
        target -= weight;
    }

    throw new Error('invalid tier config: total weight is zero');
}

/** The ECVRF output and proof produced by an operator for a pull's `alpha`. */
export interface PullReveal {
    beta: Uint8Array;
    proof: Uint8Array;
}

/**
 * Operator side: produces the 80-byte proof and 64-byte `beta` for a pull's `alpha`.
 * `operatorSecretKey` is the 32-byte Ed25519 seed registered as the pool operator.
 */
export function provePull(operatorSecretKey: Uint8Array, alpha: Uint8Array): PullReveal {
    const { proof } = proveVRF(operatorSecretKey, alpha);
    const beta = vrfProofToHash(proof);
    return { beta, proof };
}

/**
 * Verifier side: checks that `proof` is a valid ECVRF proof of `beta` for `alpha`
 * under the operator's public key. This is the off-chain verification the program
 * cannot perform on-chain.
 */
export function verifyPull(operatorPublicKey: Uint8Array, alpha: Uint8Array, proof: Uint8Array): boolean {
    return verifyVRF(operatorPublicKey, alpha, proof);
}

/**
 * The reveal provenance a prize NFT carries in its Token-2022
 * `additional_metadata`, hex-decoded. Everything needed to verify the reveal
 * lives in the mint account itself — no transaction-history lookup required.
 */
export interface PrizeProvenance {
    /** The ECVRF output, decoded from the `beta` key. */
    beta: Uint8Array;
    /** The buyer's entropy, decoded from the `client_seed` key. */
    clientSeed: Uint8Array;
    /** The 80-byte ECVRF proof, decoded from the `proof` key. */
    proof: Uint8Array;
    /** The pull address, decoded from the `pull` key. */
    pull: Uint8Array;
    /** Rarity label recorded under the `rarity` key. */
    rarity: string;
}

/** Decodes a lowercase-hex metadata value into bytes. */
export function decodeHexField(hex: string): Uint8Array {
    if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/.test(hex)) {
        throw new Error(`invalid hex metadata value: ${hex}`);
    }
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
    }
    return bytes;
}

/**
 * Verifies a prize NFT's reveal end-to-end from its metadata provenance:
 * recomputes `alpha = SHA-256(pull || client_seed)`, checks the ECVRF proof
 * against the pool's operator key, checks `beta` matches the proof, and
 * reproduces the tier from the pool's weights to confirm the recorded rarity.
 */
export function verifyPrizeProvenance(
    provenance: PrizeProvenance,
    operatorPublicKey: Uint8Array,
    weights: readonly number[],
    tierCount: number,
): boolean {
    const alpha = pullAlphaBytes(provenance.pull, provenance.clientSeed);
    if (!verifyVRF(operatorPublicKey, alpha, provenance.proof)) {
        return false;
    }
    const beta = vrfProofToHash(provenance.proof);
    if (beta.length !== provenance.beta.length || !beta.every((b, i) => b === provenance.beta[i])) {
        return false;
    }
    const tier = selectTier(provenance.beta, weights, tierCount);
    return RARITY_LABELS[tier] === provenance.rarity;
}

export { generateKeyPair, proveVRF, publicKeyFromSeed, verifyVRF, vrfProofToHash };
