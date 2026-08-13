import { addDecoderSizePrefix, getStructDecoder, getU32Decoder, getUtf8Decoder } from '@solana/kit';

// Account data layout, matching the program's `User` struct.
export const userDecoder = getStructDecoder([['name', addDecoderSizePrefix(getUtf8Decoder(), getU32Decoder())]]);
