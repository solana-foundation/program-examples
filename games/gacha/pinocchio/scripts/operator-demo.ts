/**
 * Demonstrates the off-chain operator and verifier roles for a gacha pull, with no
 * RPC. It mirrors what happens around a real `buyPull` -> `settlePull`:
 *
 *   1. A pool registers an operator (an Ed25519 key that is also its ECVRF key).
 *   2. A buyer opens a pull; its account address is the fixed VRF input `alpha`.
 *   3. The operator proves `beta = VRF(alpha)` and would submit it via `settlePull`.
 *   4. Anyone verifies the proof off-chain and reproduces the selected tier.
 *
 * Run: `just demo`
 */

import { generateKeyPair, provePull, publicKeyFromSeed, pullAlpha, selectTier, verifyPull } from '@solana/gacha';
import { findPullPda } from '@solana/gacha';
import { GACHA_PROGRAM_ADDRESS } from '@solana/gacha';

async function main() {
    // The operator's 32-byte seed is both its Solana signing key and its ECVRF key.
    const { sk, pk } = generateKeyPair();
    console.log(`Operator key matches its Ed25519 public key: ${bytesEqual(pk, publicKeyFromSeed(sk))}`);

    // A pool (here, stand-in addresses) and buyer produce a deterministic pull PDA.
    const pool = GACHA_PROGRAM_ADDRESS;
    const buyer = GACHA_PROGRAM_ADDRESS;
    const [pull] = await findPullPda({ buyer, index: 0, pool });
    const alpha = pullAlpha(pull);
    console.log(`Pull (alpha): ${pull}`);

    // Operator reveals; verifier checks and reproduces the tier.
    const { proof, beta } = provePull(sk, alpha);
    const verified = verifyPull(pk, alpha, proof);
    console.log(`Proof verifies off-chain: ${verified}`);

    const weights = [70, 25, 5];
    const supplies = [100, 50, 10];
    const tier = selectTier(beta, weights, supplies, weights.length);
    console.log(`Selected tier: ${tier} (weights ${weights.join('/')})`);

    if (!verified) process.exit(1);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
    return a.length === b.length && a.every((x, i) => x === b[i]);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
