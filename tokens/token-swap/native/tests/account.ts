import { getAddressDecoder, getStructDecoder, getU16Decoder } from '@solana/kit';

export const ammDecoder = getStructDecoder([
    ['id', getAddressDecoder()],
    ['admin', getAddressDecoder()],
    ['fee', getU16Decoder()],
]);

export const poolDecoder = getStructDecoder([
    ['amm', getAddressDecoder()],
    ['mint_a', getAddressDecoder()],
    ['mint_b', getAddressDecoder()],
]);
