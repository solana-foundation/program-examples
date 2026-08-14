import { getAddressDecoder, getStructDecoder, getU8Decoder, getU64Decoder } from '@solana/kit';

// Account data layout, matching the program's `Offer` struct.
export const offerDecoder = getStructDecoder([
    ['id', getU64Decoder()],
    ['maker', getAddressDecoder()],
    ['token_mint_a', getAddressDecoder()],
    ['token_mint_b', getAddressDecoder()],
    ['token_b_wanted_amount', getU64Decoder()],
    ['bump', getU8Decoder()],
]);
