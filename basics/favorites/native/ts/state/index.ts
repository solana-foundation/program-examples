import {
    addDecoderSizePrefix,
    getArrayDecoder,
    getStructDecoder,
    getU32Decoder,
    getU64Decoder,
    getUtf8Decoder,
} from '@solana/kit';

export type Favorites = {
    number: bigint;
    color: string;
    hobbies: string[];
};

// Account data layout, matching the program's `Favorites` struct.
export const favoritesDecoder = getStructDecoder([
    ['number', getU64Decoder()],
    ['color', addDecoderSizePrefix(getUtf8Decoder(), getU32Decoder())],
    ['hobbies', getArrayDecoder(addDecoderSizePrefix(getUtf8Decoder(), getU32Decoder()), { size: getU32Decoder() })],
]);
