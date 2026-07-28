import * as borsh from 'borsh';

export enum SplMinterInstruction {
    Create = 0,
    Mint = 1,
}

export const CreateTokenArgsSchema = {
    struct: {
        instruction: 'u8',
        token_title: 'string',
        token_symbol: 'string',
        token_uri: 'string',
    },
};

export const MintToArgsSchema = {
    struct: {
        instruction: 'u8',
        quantity: 'u64',
    },
};

export function borshSerialize(schema: borsh.Schema, data: object): Buffer {
    return Buffer.from(borsh.serialize(schema, data));
}
