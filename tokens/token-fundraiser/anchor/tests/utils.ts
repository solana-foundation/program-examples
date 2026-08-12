import { assert } from 'chai';

// Asserts `promise` rejects with the given Anchor custom error code, not
// just "something failed".
export const expectAnchorError = async (promise: Promise<unknown>, code: string) => {
    let caught: any;
    try {
        await promise;
    } catch (error) {
        caught = error;
    }
    assert.isDefined(caught, `expected the transaction to fail with ${code}`);
    assert.strictEqual(caught?.error?.errorCode?.code, code, `expected ${code}, got: ${caught}`);
};
