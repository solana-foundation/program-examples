import BN from 'bn.js';

export type Counter = {
    count: BN;
};

export const COUNTER_ACCOUNT_SIZE = 8;

export function deserializeCounterAccount(data: Buffer): Counter {
    if (data.byteLength !== 8) {
        throw Error('Need exactly 8 bytes to deserialize counter');
    }

    return {
        count: new BN(data, 'le'),
    };
}
