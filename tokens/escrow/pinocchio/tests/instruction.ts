import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { type PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import type BN from 'bn.js';
import * as borsh from 'borsh';

enum EscrowInstruction {
    MakeOffer = 0,
    TakeOffer = 1,
}

// Unlike the native example, the Pinocchio program receives the offer PDA bump
// in the instruction data (and stores it) instead of deriving it on-chain.
const MakeOfferSchema = {
    struct: {
        instruction: 'u8',
        id: 'u64',
        token_a_offered_amount: 'u64',
        token_b_wanted_amount: 'u64',
        bump: 'u8',
    },
};

const TakeOfferSchema = {
    struct: {
        instruction: 'u8',
    },
};

function borshSerialize(schema: borsh.Schema, data: object): Buffer {
    return Buffer.from(borsh.serialize(schema, data));
}

export function buildMakeOffer(props: {
    id: BN;
    token_a_offered_amount: BN;
    token_b_wanted_amount: BN;
    bump: number;
    offer: PublicKey;
    mint_a: PublicKey;
    mint_b: PublicKey;
    maker_token_a: PublicKey;
    vault: PublicKey;
    maker: PublicKey;
    payer: PublicKey;
    programId: PublicKey;
}) {
    const data = borshSerialize(MakeOfferSchema, {
        instruction: EscrowInstruction.MakeOffer,
        id: props.id,
        token_a_offered_amount: props.token_a_offered_amount,
        token_b_wanted_amount: props.token_b_wanted_amount,
        bump: props.bump,
    });

    return new TransactionInstruction({
        keys: [
            { pubkey: props.offer, isSigner: false, isWritable: true },
            { pubkey: props.mint_a, isSigner: false, isWritable: false },
            { pubkey: props.mint_b, isSigner: false, isWritable: false },
            { pubkey: props.maker_token_a, isSigner: false, isWritable: true },
            { pubkey: props.vault, isSigner: false, isWritable: true },
            { pubkey: props.maker, isSigner: true, isWritable: true },
            { pubkey: props.payer, isSigner: true, isWritable: true },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        programId: props.programId,
        data,
    });
}

export function buildTakeOffer(props: {
    offer: PublicKey;
    mint_a: PublicKey;
    mint_b: PublicKey;
    maker_token_b: PublicKey;
    taker_token_a: PublicKey;
    taker_token_b: PublicKey;
    vault: PublicKey;
    taker: PublicKey;
    maker: PublicKey;
    payer: PublicKey;
    programId: PublicKey;
}) {
    const data = borshSerialize(TakeOfferSchema, {
        instruction: EscrowInstruction.TakeOffer,
    });

    return new TransactionInstruction({
        keys: [
            { pubkey: props.offer, isSigner: false, isWritable: true },
            { pubkey: props.mint_a, isSigner: false, isWritable: false },
            { pubkey: props.mint_b, isSigner: false, isWritable: false },
            { pubkey: props.maker_token_b, isSigner: false, isWritable: true },
            { pubkey: props.taker_token_a, isSigner: false, isWritable: true },
            { pubkey: props.taker_token_b, isSigner: false, isWritable: true },
            { pubkey: props.vault, isSigner: false, isWritable: true },
            { pubkey: props.maker, isSigner: false, isWritable: false },
            { pubkey: props.taker, isSigner: true, isWritable: true },
            { pubkey: props.payer, isSigner: true, isWritable: true },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        programId: props.programId,
        data,
    });
}
