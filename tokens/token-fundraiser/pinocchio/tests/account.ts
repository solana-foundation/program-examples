import {
    getAddressDecoder,
    getI64Decoder,
    getStructDecoder,
    getU16Decoder,
    getU8Decoder,
    getU64Decoder,
} from '@solana/kit';

// Account data layout, matching the program's `Fundraiser` struct.
export const fundraiserDecoder = getStructDecoder([
    ['maker', getAddressDecoder()],
    ['mint_to_raise', getAddressDecoder()],
    ['amount_to_raise', getU64Decoder()],
    ['current_amount', getU64Decoder()],
    ['time_started', getI64Decoder()],
    ['duration', getU16Decoder()],
    ['bump', getU8Decoder()],
]);

// Account data layout, matching the program's `Contributor` struct.
export const contributorDecoder = getStructDecoder([['amount', getU64Decoder()]]);
