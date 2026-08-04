import { generateKeyPair, proveVRF, publicKeyFromSeed, verifyVRF, vrfProofToHash } from '@collectorcrypt/ecvrf';
import { sha256 } from '@noble/hashes/sha2.js';
import { type Address, getAddressEncoder } from '@solana/kit';

import { MAX_TIERS } from './constants.js';

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
    const pullBytes = new Uint8Array(getAddressEncoder().encode(pull));
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

export { generateKeyPair, proveVRF, publicKeyFromSeed, verifyVRF, vrfProofToHash };
