import assert from 'node:assert/strict';

import { tokenAmountToBaseUnits } from '../src/lib/token-amount';

describe('tokenAmountToBaseUnits', () => {
    it('converts whole amounts for zero-decimal mints', () => {
        assert.equal(tokenAmountToBaseUnits('1', 0), 1n);
        assert.equal(tokenAmountToBaseUnits('1.', 0), 1n);
        assert.equal(tokenAmountToBaseUnits('1.0', 0), 1n);
    });

    it('scales fractional and shorthand amounts into base units', () => {
        assert.equal(tokenAmountToBaseUnits('1.23', 2), 123n);
        assert.equal(tokenAmountToBaseUnits('.5', 6), 500_000n);
        assert.equal(tokenAmountToBaseUnits('1.5', 6), 1_500_000n);
    });

    it('accepts trailing zeroes that do not add precision', () => {
        assert.equal(tokenAmountToBaseUnits('1.230', 2), 123n);
        assert.equal(tokenAmountToBaseUnits(' 1.230 ', 2), 123n);
        assert.equal(tokenAmountToBaseUnits('0.0100', 2), 1n);
    });

    it('accepts the smallest representable amount', () => {
        assert.equal(tokenAmountToBaseUnits('0.000001', 6), 1n);
    });

    it('rejects invalid and non-positive input', () => {
        for (const amount of ['', '.', 'abc', '-1', '0', '0.0', '.0', '1e3']) {
            assert.throws(() => tokenAmountToBaseUnits(amount, 6));
        }
    });

    it('rejects excess significant precision', () => {
        assert.throws(() => tokenAmountToBaseUnits('1.234', 2), /at most 2 decimal places/);
        assert.throws(() => tokenAmountToBaseUnits('.001', 2), /at most 2 decimal places/);
    });
});
