import assert from 'node:assert/strict';
import { test } from 'node:test';

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
    const remaining = [5, 5, 5];
    assert.equal(selectTier(betaFrom(0n), weights, remaining, 3), 0);
    assert.equal(selectTier(betaFrom(59n), weights, remaining, 3), 0);
    assert.equal(selectTier(betaFrom(60n), weights, remaining, 3), 1);
    assert.equal(selectTier(betaFrom(89n), weights, remaining, 3), 1);
    assert.equal(selectTier(betaFrom(90n), weights, remaining, 3), 2);
    assert.equal(selectTier(betaFrom(99n), weights, remaining, 3), 2);
});

test('selectTier wraps via modulo', () => {
    const weights = [60, 30, 10];
    const remaining = [5, 5, 5];
    assert.equal(selectTier(betaFrom(100n), weights, remaining, 3), 0);
    assert.equal(selectTier(betaFrom(190n), weights, remaining, 3), 2);
});

test('selectTier skips exhausted tiers', () => {
    const weights = [60, 30, 10];
    const remaining = [0, 5, 5];
    assert.equal(selectTier(betaFrom(0n), weights, remaining, 3), 1);
    assert.equal(selectTier(betaFrom(29n), weights, remaining, 3), 1);
    assert.equal(selectTier(betaFrom(30n), weights, remaining, 3), 2);
});

test('selectTier respects tierCount', () => {
    const weights = [60, 40, 10];
    const remaining = [5, 5, 5];
    assert.equal(selectTier(betaFrom(99n), weights, remaining, 2), 1);
});

test('selectTier throws when fully exhausted', () => {
    assert.throws(() => selectTier(betaFrom(0n), [60, 30, 10], [0, 0, 0], 3));
});

// End-to-end ECVRF: prove a pull's alpha, verify the proof, and expand beta.
test('ECVRF prove/verify round-trip drives a tier selection', () => {
    const { sk, pk } = generateKeyPair();
    const alpha = new Uint8Array(32).fill(7); // stand-in for a pull address

    const { proof, beta } = provePull(sk, alpha);
    assert.equal(beta.length, 64);
    assert.equal(verifyPull(pk, alpha, proof), true);

    // A different alpha must not verify against this proof.
    const wrongAlpha = new Uint8Array(32).fill(8);
    assert.equal(verifyPull(pk, wrongAlpha, proof), false);

    const tier = selectTier(beta, [70, 25, 5], [10, 10, 10], 3);
    assert.ok(tier >= 0 && tier < 3);
});

test('pullAlpha returns 32 bytes', () => {
    const alpha = pullAlpha('Bv65bJKK9kwTERuyHdCrXqWf2gKBFwkTx2rnscXaBZsS' as never);
    assert.equal(alpha.length, 32);
});
