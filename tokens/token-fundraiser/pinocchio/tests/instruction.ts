import {
    AccountRole,
    type Address,
    getStructEncoder,
    getU16Encoder,
    getU8Encoder,
    getU64Encoder,
    type KeyPairSigner,
} from '@solana/kit';
import { SYSTEM_PROGRAM_ADDRESS } from '@solana-program/system';
import { ASSOCIATED_TOKEN_PROGRAM_ADDRESS, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';

export enum FundraiserInstruction {
    Initialize = 0,
    Contribute = 1,
    CheckContributions = 2,
    Refund = 3,
}

// PDA bumps are derived client-side and passed in the instruction data, which
// the program re-checks with `create_program_address`. This keeps the expensive
// `find_program_address` search off-chain.
const initializeEncoder = getStructEncoder([
    ['instruction', getU8Encoder()],
    ['amount', getU64Encoder()],
    ['duration', getU16Encoder()],
    ['bump', getU8Encoder()],
]);

const contributeEncoder = getStructEncoder([
    ['instruction', getU8Encoder()],
    ['amount', getU64Encoder()],
    ['contributor_bump', getU8Encoder()],
]);

const checkContributionsEncoder = getStructEncoder([['instruction', getU8Encoder()]]);

const refundEncoder = getStructEncoder([
    ['instruction', getU8Encoder()],
    ['contributor_bump', getU8Encoder()],
]);

export function buildInitialize(props: {
    amount: bigint;
    duration: number;
    bump: number;
    maker: KeyPairSigner;
    mint: Address;
    fundraiser: Address;
    vault: Address;
    programId: Address;
}) {
    const data = initializeEncoder.encode({
        instruction: FundraiserInstruction.Initialize,
        amount: props.amount,
        duration: props.duration,
        bump: props.bump,
    });

    return {
        programAddress: props.programId,
        accounts: [
            { address: props.maker.address, role: AccountRole.WRITABLE_SIGNER, signer: props.maker },
            { address: props.mint, role: AccountRole.READONLY },
            { address: props.fundraiser, role: AccountRole.WRITABLE },
            { address: props.vault, role: AccountRole.WRITABLE },
            { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            { address: ASSOCIATED_TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
        ],
        data,
    };
}

export function buildContribute(props: {
    amount: bigint;
    contributorBump: number;
    contributor: KeyPairSigner;
    mint: Address;
    fundraiser: Address;
    contributorAccount: Address;
    contributorAta: Address;
    vault: Address;
    programId: Address;
}) {
    const data = contributeEncoder.encode({
        instruction: FundraiserInstruction.Contribute,
        amount: props.amount,
        contributor_bump: props.contributorBump,
    });

    return {
        programAddress: props.programId,
        accounts: [
            { address: props.contributor.address, role: AccountRole.WRITABLE_SIGNER, signer: props.contributor },
            { address: props.mint, role: AccountRole.READONLY },
            { address: props.fundraiser, role: AccountRole.WRITABLE },
            { address: props.contributorAccount, role: AccountRole.WRITABLE },
            { address: props.contributorAta, role: AccountRole.WRITABLE },
            { address: props.vault, role: AccountRole.WRITABLE },
            { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
        ],
        data,
    };
}

export function buildCheckContributions(props: {
    maker: KeyPairSigner;
    mint: Address;
    fundraiser: Address;
    vault: Address;
    makerAta: Address;
    programId: Address;
}) {
    const data = checkContributionsEncoder.encode({
        instruction: FundraiserInstruction.CheckContributions,
    });

    return {
        programAddress: props.programId,
        accounts: [
            { address: props.maker.address, role: AccountRole.WRITABLE_SIGNER, signer: props.maker },
            { address: props.mint, role: AccountRole.READONLY },
            { address: props.fundraiser, role: AccountRole.WRITABLE },
            { address: props.vault, role: AccountRole.WRITABLE },
            { address: props.makerAta, role: AccountRole.WRITABLE },
            { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            { address: ASSOCIATED_TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
        ],
        data,
    };
}

export function buildRefund(props: {
    contributorBump: number;
    contributor: KeyPairSigner;
    mint: Address;
    fundraiser: Address;
    contributorAccount: Address;
    contributorAta: Address;
    vault: Address;
    programId: Address;
}) {
    const data = refundEncoder.encode({
        instruction: FundraiserInstruction.Refund,
        contributor_bump: props.contributorBump,
    });

    return {
        programAddress: props.programId,
        accounts: [
            { address: props.contributor.address, role: AccountRole.WRITABLE_SIGNER, signer: props.contributor },
            { address: props.mint, role: AccountRole.READONLY },
            { address: props.fundraiser, role: AccountRole.WRITABLE },
            { address: props.contributorAccount, role: AccountRole.WRITABLE },
            { address: props.contributorAta, role: AccountRole.WRITABLE },
            { address: props.vault, role: AccountRole.WRITABLE },
            { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
        ],
        data,
    };
}
