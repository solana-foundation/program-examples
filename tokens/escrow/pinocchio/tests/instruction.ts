import { AccountRole, type Address, type KeyPairSigner } from '@solana/kit';
import { SYSTEM_PROGRAM_ADDRESS } from '@solana-program/system';
import { ASSOCIATED_TOKEN_PROGRAM_ADDRESS, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import * as borsh from 'borsh';

enum EscrowInstruction {
    MakeOffer = 0,
    TakeOffer = 1,
    RefundOffer = 2,
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

const RefundOfferSchema = {
    struct: {
        instruction: 'u8',
    },
};

export function buildMakeOffer(props: {
    id: bigint;
    token_a_offered_amount: bigint;
    token_b_wanted_amount: bigint;
    bump: number;
    offer: Address;
    mint_a: Address;
    mint_b: Address;
    maker_token_a: Address;
    vault: Address;
    maker: KeyPairSigner;
    payer: KeyPairSigner;
    programId: Address;
}) {
    const data = borsh.serialize(MakeOfferSchema, {
        instruction: EscrowInstruction.MakeOffer,
        id: props.id,
        token_a_offered_amount: props.token_a_offered_amount,
        token_b_wanted_amount: props.token_b_wanted_amount,
        bump: props.bump,
    });

    return {
        programAddress: props.programId,
        accounts: [
            { address: props.offer, role: AccountRole.WRITABLE },
            { address: props.mint_a, role: AccountRole.READONLY },
            { address: props.mint_b, role: AccountRole.READONLY },
            { address: props.maker_token_a, role: AccountRole.WRITABLE },
            { address: props.vault, role: AccountRole.WRITABLE },
            { address: props.maker.address, role: AccountRole.WRITABLE_SIGNER, signer: props.maker },
            { address: props.payer.address, role: AccountRole.WRITABLE_SIGNER, signer: props.payer },
            { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            { address: ASSOCIATED_TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
        ],
        data,
    };
}

export function buildTakeOffer(props: {
    offer: Address;
    mint_a: Address;
    mint_b: Address;
    maker_token_b: Address;
    taker_token_a: Address;
    taker_token_b: Address;
    vault: Address;
    taker: KeyPairSigner;
    maker: Address;
    payer: KeyPairSigner;
    programId: Address;
}) {
    const data = borsh.serialize(TakeOfferSchema, {
        instruction: EscrowInstruction.TakeOffer,
    });

    return {
        programAddress: props.programId,
        accounts: [
            { address: props.offer, role: AccountRole.WRITABLE },
            { address: props.mint_a, role: AccountRole.READONLY },
            { address: props.mint_b, role: AccountRole.READONLY },
            { address: props.maker_token_b, role: AccountRole.WRITABLE },
            { address: props.taker_token_a, role: AccountRole.WRITABLE },
            { address: props.taker_token_b, role: AccountRole.WRITABLE },
            { address: props.vault, role: AccountRole.WRITABLE },
            { address: props.maker, role: AccountRole.READONLY },
            { address: props.taker.address, role: AccountRole.WRITABLE_SIGNER, signer: props.taker },
            { address: props.payer.address, role: AccountRole.WRITABLE_SIGNER, signer: props.payer },
            { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            { address: ASSOCIATED_TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
        ],
        data,
    };
}

export function buildRefundOffer(props: {
    offer: Address;
    mint_a: Address;
    maker_token_a: Address;
    vault: Address;
    maker: KeyPairSigner;
    programId: Address;
}) {
    const data = borsh.serialize(RefundOfferSchema, {
        instruction: EscrowInstruction.RefundOffer,
    });

    return {
        programAddress: props.programId,
        accounts: [
            { address: props.offer, role: AccountRole.WRITABLE },
            { address: props.mint_a, role: AccountRole.READONLY },
            { address: props.maker_token_a, role: AccountRole.WRITABLE },
            { address: props.vault, role: AccountRole.WRITABLE },
            { address: props.maker.address, role: AccountRole.WRITABLE_SIGNER, signer: props.maker },
            { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
        ],
        data,
    };
}
