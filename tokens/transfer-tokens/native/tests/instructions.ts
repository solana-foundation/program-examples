import * as borsh from 'borsh';

export enum MyInstruction {
    Create = 0,
    MintNft = 1,
    MintSpl = 2,
    TransferTokens = 3,
}

export const CreateTokenArgsSchema = {
    struct: {
        instruction: 'u8',
        token_title: 'string',
        token_symbol: 'string',
        token_uri: 'string',
        decimals: 'u8',
    },
};

export const MintNftArgsSchema = { struct: { instruction: 'u8' } };

export const MintSplArgsSchema = {
    struct: {
        instruction: 'u8',
        quantity: 'u64',
    },
};

export const TransferTokensArgsSchema = {
    struct: {
        instruction: 'u8',
        quantity: 'u64',
    },
};

export function borshSerialize(schema: borsh.Schema, data: object): Buffer {
    return Buffer.from(borsh.serialize(schema, data));
}
