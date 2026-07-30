/**
 * Demonstrates the off-chain operator and verifier roles for a gacha pull, with no
 * RPC. It mirrors what happens around a real `buyPull` -> `settlePull`:
 *
 *   1. A pool registers an operator (an Ed25519 key that is also its ECVRF key,
 *      registered and frozen in the cc-vrf authority registry).
 *   2. A buyer opens a pull with 32 random bytes of `clientSeed`; the VRF input is
 *      `alpha = SHA-256(pull_address || clientSeed)` — unpredictable to the
 *      operator until the buy lands, so outcomes cannot be precomputed.
 *   3. The operator proves `beta = VRF(alpha)` and submits it via `settlePull`,
 *      which anchors the proof in the cc-vrf registry.
 *   4. Anyone recomputes `alpha` from the `PullRequestedEvent`, verifies the proof,
 *      and reproduces the selected tier.
 *
 * Run: `just demo`
 */

import { randomBytes } from 'node:crypto';

import { generateKeyPair, provePull, publicKeyFromSeed, pullAlpha, selectTier, verifyPull } from '@solana/gacha';
import { findPullPda, RARITY_LABELS } from '@solana/gacha';
import { GACHA_PROGRAM_ADDRESS } from '@solana/gacha';

async function main() {
    // The operator's 32-byte seed is both its Solana signing key and its ECVRF key.
    const { sk, pk } = generateKeyPair();
    console.log(`Operator key matches its Ed25519 public key: ${bytesEqual(pk, publicKeyFromSeed(sk))}`);

    // A pool (here, stand-in addresses) and buyer produce a deterministic pull PDA.
    // The buyer's random clientSeed is what makes alpha unpredictable.
    const pool = GACHA_PROGRAM_ADDRESS;
    const buyer = GACHA_PROGRAM_ADDRESS;
    const clientSeed = new Uint8Array(randomBytes(32));
    const [pull] = await findPullPda({ buyer, index: 0, pool });
    const alpha = pullAlpha(pull, clientSeed);
    console.log(`Pull: ${pull}`);
    console.log(`alpha = SHA-256(pull || clientSeed): ${Buffer.from(alpha).toString('hex')}`);

    // Operator reveals; verifier recomputes alpha, checks the proof, and
    // reproduces the tier.
    const { proof, beta } = provePull(sk, alpha);
    const verifierAlpha = pullAlpha(pull, clientSeed);
    const verified = verifyPull(pk, verifierAlpha, proof);
    console.log(`Proof verifies off-chain: ${verified}`);

    // A tampered proof must not verify — this detection is the accountability
    // the on-chain program cannot provide itself.
    const tampered = proof.slice();
    tampered[0] ^= 1;
    console.log(`Tampered proof rejected: ${!verifyPull(pk, verifierAlpha, tampered)}`);

    const weights = [70, 25, 5];
    const tier = selectTier(beta, weights, weights.length);
    console.log(`Selected tier: ${tier} (${RARITY_LABELS[tier]}, weights ${weights.join('/')})`);

    if (!verified) process.exit(1);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
    return a.length === b.length && a.every((x, i) => x === b[i]);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
