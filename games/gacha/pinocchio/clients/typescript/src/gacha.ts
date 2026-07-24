import { generateKeyPair, proveVRF, publicKeyFromSeed, verifyVRF, vrfProofToHash } from '@collectorcrypt/ecvrf';
import {
    type Address,
    getAddressEncoder,
    getProgramDerivedAddress,
    getU64Encoder,
    getUtf8Encoder,
    type ProgramDerivedAddress,
} from '@solana/kit';

import { MAX_TIERS } from './constants.js';
import { GACHA_PROGRAM_ADDRESS } from './generated/index.js';

/** Seeds for a pull PDA: `["pull", pool, buyer, index_le]`. */
export type PullSeeds = {
    buyer: Address;
    index: bigint | number;
    pool: Address;
};

/**
 * Derives the pull PDA. The generated client derives the pool and vault PDAs, but
 * the pull PDA uses a numeric seed, so it is derived here.
 */
export async function findPullPda(
    seeds: PullSeeds,
    config: { programAddress?: Address } = {},
): Promise<ProgramDerivedAddress> {
    const { programAddress = GACHA_PROGRAM_ADDRESS } = config;
    return await getProgramDerivedAddress({
        programAddress,
        seeds: [
            getUtf8Encoder().encode('pull'),
            getAddressEncoder().encode(seeds.pool),
            getAddressEncoder().encode(seeds.buyer),
            getU64Encoder().encode(BigInt(seeds.index)),
        ],
    });
}

/** The VRF input for a pull: its account address, as raw bytes. */
export function pullAlpha(pull: Address): Uint8Array {
    return new Uint8Array(getAddressEncoder().encode(pull));
}

/**
 * Selects a reward tier from a VRF output, weighted by each tier's weight and
 * restricted to tiers with remaining supply.
 *
 * Byte-for-byte mirror of the on-chain `select_tier`: the first 16 bytes of `beta`
 * are read as a little-endian u128 and reduced modulo the total available weight,
 * then the target walks the tiers in order, skipping any with zero remaining supply.
 * Throws when no tier has remaining supply.
 */
export function selectTier(
    beta: Uint8Array,
    weights: readonly number[],
    remaining: readonly number[],
    tierCount: number,
): number {
    const count = Math.min(tierCount, MAX_TIERS);

    let total = 0n;
    for (let i = 0; i < count; i++) {
        if ((remaining[i] ?? 0) > 0) {
            total += BigInt(weights[i] ?? 0);
        }
    }
    if (total === 0n) {
        throw new Error('pool exhausted: no tier has remaining supply');
    }

    let seed = 0n;
    for (let i = 0; i < 16; i++) {
        seed |= BigInt(beta[i] ?? 0) << BigInt(8 * i);
    }
    let target = seed % total;

    for (let i = 0; i < count; i++) {
        if ((remaining[i] ?? 0) === 0) {
            continue;
        }
        const weight = BigInt(weights[i] ?? 0);
        if (target < weight) {
            return i;
        }
        target -= weight;
    }

    throw new Error('pool exhausted: no tier has remaining supply');
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
