import * as borsh from 'borsh';

export const OfferSchema = {
    struct: {
        id: 'u64',
        maker: { array: { type: 'u8', len: 32 } },
        token_mint_a: { array: { type: 'u8', len: 32 } },
        token_mint_b: { array: { type: 'u8', len: 32 } },
        token_b_wanted_amount: 'u64',
        bump: 'u8',
    },
};

export type OfferRaw = {
    id: bigint;
    maker: Uint8Array;
    token_mint_a: Uint8Array;
    token_mint_b: Uint8Array;
    token_b_wanted_amount: bigint;
    bump: number;
};

export function borshSerialize(schema: borsh.Schema, data: object): Buffer {
    return Buffer.from(borsh.serialize(schema, data));
}
