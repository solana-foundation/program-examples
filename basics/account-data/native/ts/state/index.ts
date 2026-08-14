import { addDecoderSizePrefix, getStructDecoder, getU8Decoder, getU32Decoder, getUtf8Decoder } from '@solana/kit';

export type AddressInfo = {
    name: string;
    houseNumber: number;
    street: string;
    city: string;
};

// Account data layout, matching the program's `AddressInfo` struct.
export const addressInfoDecoder = getStructDecoder([
    ['name', addDecoderSizePrefix(getUtf8Decoder(), getU32Decoder())],
    ['houseNumber', getU8Decoder()],
    ['street', addDecoderSizePrefix(getUtf8Decoder(), getU32Decoder())],
    ['city', addDecoderSizePrefix(getUtf8Decoder(), getU32Decoder())],
]);
