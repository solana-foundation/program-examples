import { AccountRole, type Address, type TransactionSigner } from '@solana/kit';
import { SYSTEM_PROGRAM_ADDRESS } from '@solana-program/system';
import { ASSOCIATED_TOKEN_PROGRAM_ADDRESS, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import * as borsh from 'borsh';

enum EscrowInstruction {
    MakeOffer = 0,
    TakeOffer = 1,
}

const MakeOfferSchema = {
    struct: {
        instruction: 'u8',
        id: 'u64',
        token_a_offered_amount: 'u64',
        token_b_wanted_amount: 'u64',
    },
};

const TakeOfferSchema = {
    struct: {
        instruction: 'u8',
    },
};

function borshSerialize(schema: borsh.Schema, data: object): Uint8Array {
    return borsh.serialize(schema, data);
}

export function buildMakeOffer(props: {
    id: bigint;
    token_a_offered_amount: bigint;
    token_b_wanted_amount: bigint;
    offer: Address;
    mint_a: Address;
    mint_b: Address;
    maker_token_a: Address;
    vault: Address;
    maker: TransactionSigner;
    payer: TransactionSigner;
    programId: Address;
}) {
    const data = borshSerialize(MakeOfferSchema, {
        instruction: EscrowInstruction.MakeOffer,
        id: props.id,
        token_a_offered_amount: props.token_a_offered_amount,
        token_b_wanted_amount: props.token_b_wanted_amount,
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
    taker: TransactionSigner;
    maker: Address;
    payer: TransactionSigner;
    programId: Address;
}) {
    const data = borshSerialize(TakeOfferSchema, {
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
