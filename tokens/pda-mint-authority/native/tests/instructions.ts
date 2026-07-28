import * as borsh from 'borsh';

export enum NftMinterInstruction {
    Init = 0,
    Create = 1,
    Mint = 2,
}

export const InitArgsSchema = { struct: { instruction: 'u8' } };

export const CreateTokenArgsSchema = {
    struct: {
        instruction: 'u8',
        nft_title: 'string',
        nft_symbol: 'string',
        nft_uri: 'string',
    },
};

export const MintToArgsSchema = { struct: { instruction: 'u8' } };

export function borshSerialize(schema: borsh.Schema, data: object): Buffer {
    return Buffer.from(borsh.serialize(schema, data));
}
