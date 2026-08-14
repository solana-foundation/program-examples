import { addDecoderSizePrefix, getStructDecoder, getU8Decoder, getU32Decoder, getUtf8Decoder } from '@solana/kit';

// Account data layout, matching the program's `EnhancedAddressInfo` struct.
export const enhancedAddressInfoDecoder = getStructDecoder([
    ['name', addDecoderSizePrefix(getUtf8Decoder(), getU32Decoder())],
    ['house_number', getU8Decoder()],
    ['street', addDecoderSizePrefix(getUtf8Decoder(), getU32Decoder())],
    ['city', addDecoderSizePrefix(getUtf8Decoder(), getU32Decoder())],
    ['state', addDecoderSizePrefix(getUtf8Decoder(), getU32Decoder())],
    ['zip', getU32Decoder()],
]);
