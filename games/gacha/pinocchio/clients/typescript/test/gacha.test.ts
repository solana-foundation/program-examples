import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Address } from '@solana/kit';

import { generateKeyPair, provePull, pullAlpha, selectTier, verifyPull } from '../src/gacha.js';

/** Builds a `beta` whose first 16 bytes encode `value` as a little-endian u128. */
function betaFrom(value: bigint): Uint8Array {
    const beta = new Uint8Array(64);
    let v = value;
    for (let i = 0; i < 16; i++) {
        beta[i] = Number(v & 0xffn);
        v >>= 8n;
    }
    return beta;
}

// These fixtures mirror the on-chain `select_tier` host unit tests exactly, so the
// two implementations are pinned to the same weighted-bucket behavior.
test('selectTier matches the on-chain weighted buckets', () => {
    const weights = [60, 30, 10];
    assert.equal(selectTier(betaFrom(0n), weights, 3), 0);
    assert.equal(selectTier(betaFrom(59n), weights, 3), 0);
    assert.equal(selectTier(betaFrom(60n), weights, 3), 1);
    assert.equal(selectTier(betaFrom(89n), weights, 3), 1);
    assert.equal(selectTier(betaFrom(90n), weights, 3), 2);
    assert.equal(selectTier(betaFrom(99n), weights, 3), 2);
});

test('selectTier wraps via modulo', () => {
    const weights = [60, 30, 10];
    assert.equal(selectTier(betaFrom(100n), weights, 3), 0);
    assert.equal(selectTier(betaFrom(190n), weights, 3), 2);
});

test('selectTier respects tierCount', () => {
    assert.equal(selectTier(betaFrom(99n), [60, 40, 10], 2), 1);
});

test('selectTier throws on zero total weight', () => {
    assert.throws(() => selectTier(betaFrom(0n), [0, 0, 0], 3));
});

// Pinned cross-language fixture: the on-chain `derive_alpha` host unit test uses
// the same inputs and digest, keeping the two implementations byte-identical.
// The address below is the base58 form of 32 bytes of 0x01.
test('pullAlpha matches the on-chain pinned fixture', () => {
    const pull = '4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi' as Address;
    const clientSeed = new Uint8Array(32).fill(2);
    const expected = 'f818afd37a6dc3bc92fb44731011277006db4efa6e9023cd7468c02335d22a4d';
    assert.equal(Buffer.from(pullAlpha(pull, clientSeed)).toString('hex'), expected);
});

test('pullAlpha depends on both the pull and the client seed', () => {
    const pull = '4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi' as Address;
    const base = pullAlpha(pull, new Uint8Array(32).fill(2));
    assert.notDeepEqual(pullAlpha(pull, new Uint8Array(32).fill(3)), base);
});

// End-to-end ECVRF: prove a pull's alpha, verify the proof, and expand beta.
test('ECVRF prove/verify round-trip drives a tier selection', () => {
    const { sk, pk } = generateKeyPair();
    const alpha = pullAlpha('4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi' as Address, new Uint8Array(32).fill(7));

    const { proof, beta } = provePull(sk, alpha);
    assert.equal(beta.length, 64);
    assert.equal(verifyPull(pk, alpha, proof), true);

    const tier = selectTier(beta, [70, 25, 5], 3);
    assert.ok(tier >= 0 && tier < 3);
});

// The guarantee the whole design rests on: a reveal the operator did not honestly
// derive from `alpha` fails off-chain verification. The program cannot check the
// proof on-chain, so this detection is what keeps a cheating operator accountable.
test('forged reveals fail verification', () => {
    const { sk, pk } = generateKeyPair();
    const alpha = pullAlpha('4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi' as Address, new Uint8Array(32).fill(9));
    const { proof } = provePull(sk, alpha);

    // Any tampering with the proof bytes invalidates it.
    for (const i of [0, 40, 79]) {
        const tampered = proof.slice();
        tampered[i] ^= 0x01;
        assert.equal(verifyPull(pk, alpha, tampered), false);
    }

    // A proof for a different alpha does not verify (no reveal reuse).
    const otherAlpha = pullAlpha('4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi' as Address, new Uint8Array(32).fill(10));
    assert.equal(verifyPull(pk, otherAlpha, proof), false);

    // A proof from a key that is not the registered operator does not verify.
    const { sk: rogueSk } = generateKeyPair();
    const { proof: rogueProof } = provePull(rogueSk, alpha);
    assert.equal(verifyPull(pk, alpha, rogueProof), false);
});
