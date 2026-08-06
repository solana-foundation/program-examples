import { getU64Decoder } from '@solana/kit';

export type Counter = {
    count: bigint;
};

export const COUNTER_ACCOUNT_SIZE = 8;

export function deserializeCounterAccount(data: Buffer): Counter {
    if (data.byteLength !== 8) {
        throw Error('Need exactly 8 bytes to deserialize counter');
    }

    return {
        count: getU64Decoder().decode(data),
    };
}
