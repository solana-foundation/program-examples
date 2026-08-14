import { getStructDecoder, getU32Decoder, getU8Decoder } from '@solana/kit';

// Account data layout, matching the program's `PageVisits` struct.
export const pageVisitsDecoder = getStructDecoder([
    ['pageVisits', getU32Decoder()],
    ['bump', getU8Decoder()],
]);
