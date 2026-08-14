import { addDecoderSizePrefix, getStructDecoder, getU8Decoder, getU32Decoder, getUtf8Decoder } from '@solana/kit';

// Account data layout, matching the program's `WorkInfo` struct.
export const workInfoDecoder = getStructDecoder([
    ['name', addDecoderSizePrefix(getUtf8Decoder(), getU32Decoder())],
    ['position', addDecoderSizePrefix(getUtf8Decoder(), getU32Decoder())],
    ['company', addDecoderSizePrefix(getUtf8Decoder(), getU32Decoder())],
    ['years_employed', getU8Decoder()],
]);
