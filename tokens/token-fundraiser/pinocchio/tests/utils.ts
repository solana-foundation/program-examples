import {
    type Address,
    appendTransactionMessageInstructions,
    createTransactionMessage,
    generateKeyPairSigner,
    getAddressEncoder,
    getProgramDerivedAddress,
    type Instruction,
    type KeyPairSigner,
    lamports,
    pipe,
    setTransactionMessageFeePayerSigner,
    signTransactionMessageWithSigners,
} from '@solana/kit';
import { getCreateAccountInstruction } from '@solana-program/system';
import {
    findAssociatedTokenPda,
    getCreateAssociatedTokenIdempotentInstruction,
    getInitializeMint2Instruction,
    getMintSize,
    getMintToInstruction,
    TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token';
import { FailedTransactionMetadata, type LiteSVM } from 'litesvm';

const addressEncoder = getAddressEncoder();

/// Mirrors the `FundraiserError` enum in the program. `ProgramError::Custom(n)`
/// carries the variant's discriminant, so the tests can pin the exact reason a
/// transaction was rejected instead of just "it failed".
export enum FundraiserError {
    TargetNotMet = 0,
    TargetMet = 1,
    ContributionTooBig = 2,
    ContributionTooSmall = 3,
    MaximumContributionsReached = 4,
    FundraiserNotEnded = 5,
    FundraiserEnded = 6,
    InvalidAmount = 7,
    InvalidAccount = 8,
    ArithmeticOverflow = 9,
}

export const DECIMALS = 6;
export const SECONDS_PER_DAY = 86400n;

async function buildSignedTransaction(svm: LiteSVM, payer: KeyPairSigner, instructions: readonly Instruction[]) {
    // Several tests send byte-identical transactions (the same rejected call
    // retried, or a call that failed and then succeeds). litesvm rejects a
    // repeated signature as AlreadyProcessed, so every send starts from a fresh
    // blockhash.
    svm.expireBlockhash();
    const transactionMessage = pipe(
        createTransactionMessage({ version: 0 }),
        m => setTransactionMessageFeePayerSigner(payer, m),
        m => svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
        m => appendTransactionMessageInstructions(instructions, m),
    );
    return signTransactionMessageWithSigners(transactionMessage);
}

/// Sends a transaction and throws if it failed.
export async function sendInstructions(svm: LiteSVM, payer: KeyPairSigner, instructions: readonly Instruction[]) {
    const signedTx = await buildSignedTransaction(svm, payer, instructions);
    const result = svm.sendTransaction(signedTx);
    if (result instanceof FailedTransactionMetadata) {
        throw new Error(`transaction failed: ${result.toString()}`);
    }
    return result;
}

/// Sends a transaction expected to fail, and asserts it failed with `expected`.
///
/// litesvm never throws on a failed transaction, so the failure has to be
/// detected with an `instanceof` check rather than a try/catch.
export async function expectProgramError(
    svm: LiteSVM,
    payer: KeyPairSigner,
    instructions: readonly Instruction[],
    expected: FundraiserError,
) {
    const signedTx = await buildSignedTransaction(svm, payer, instructions);
    const result = svm.sendTransaction(signedTx);
    if (!(result instanceof FailedTransactionMetadata)) {
        throw new Error(`expected the transaction to fail with Custom(${expected}), but it succeeded`);
    }
    // litesvm renders this as `InstructionErrorCustom { code: N }`; older
    // formats print `Custom(N)`. Pull the code out rather than matching prose.
    const message = result.err().toString();
    const code = message.match(/code:\s*(\d+)/)?.[1] ?? message.match(/Custom\((\d+)\)/)?.[1];
    if (code === undefined || Number(code) !== expected) {
        throw new Error(
            `expected the transaction to fail with ${FundraiserError[expected]} (${expected}), got: ${message}`,
        );
    }
}

/// Sends a transaction expected to fail for a reason the runtime raises rather
/// than the program (missing signature, bad seeds, wrong owner).
export async function expectFailure(svm: LiteSVM, payer: KeyPairSigner, instructions: readonly Instruction[]) {
    const signedTx = await buildSignedTransaction(svm, payer, instructions);
    const result = svm.sendTransaction(signedTx);
    if (!(result instanceof FailedTransactionMetadata)) {
        throw new Error('expected the transaction to fail, but it succeeded');
    }
}

/// Creates a mint with `payer` as the mint authority.
export async function createMint(svm: LiteSVM, payer: KeyPairSigner, mintKeypair: KeyPairSigner, decimals = DECIMALS) {
    await sendInstructions(svm, payer, [
        getCreateAccountInstruction({
            payer,
            newAccount: mintKeypair,
            lamports: svm.minimumBalanceForRentExemption(BigInt(getMintSize())),
            space: getMintSize(),
            programAddress: TOKEN_PROGRAM_ADDRESS,
        }),
        getInitializeMint2Instruction({
            mint: mintKeypair.address,
            decimals,
            mintAuthority: payer.address,
            freezeAuthority: payer.address,
        }),
    ]);
}

/// Creates a funded wallet holding `amount` base units of `mint`.
export async function createFundedHolder(
    svm: LiteSVM,
    payer: KeyPairSigner,
    mint: Address,
    amount: bigint,
): Promise<{ holder: KeyPairSigner; ata: Address }> {
    const holder = await generateKeyPairSigner();
    svm.airdrop(holder.address, lamports(1_000_000_000n));

    const [ata] = await findAssociatedTokenPda({ mint, owner: holder.address, tokenProgram: TOKEN_PROGRAM_ADDRESS });

    await sendInstructions(svm, payer, [
        getCreateAssociatedTokenIdempotentInstruction({ payer, ata, owner: holder.address, mint }),
    ]);

    if (amount > 0n) {
        await sendInstructions(svm, payer, [getMintToInstruction({ mint, token: ata, mintAuthority: payer, amount })]);
    }

    return { holder, ata };
}

/// Derives the fundraiser PDA: `[b"fundraiser", maker]`.
export function findFundraiserPda(programId: Address, maker: Address) {
    return getProgramDerivedAddress({
        programAddress: programId,
        seeds: ['fundraiser', addressEncoder.encode(maker)],
    });
}

/// Derives the contributor PDA: `[b"contributor", fundraiser, contributor]`.
export function findContributorPda(programId: Address, fundraiser: Address, contributor: Address) {
    return getProgramDerivedAddress({
        programAddress: programId,
        seeds: ['contributor', addressEncoder.encode(fundraiser), addressEncoder.encode(contributor)],
    });
}

/// Derives an associated token account address.
export async function findAta(mint: Address, owner: Address): Promise<Address> {
    const [ata] = await findAssociatedTokenPda({ mint, owner, tokenProgram: TOKEN_PROGRAM_ADDRESS });
    return ata;
}

/// Moves the validator clock to `timestamp`.
export function warpTo(svm: LiteSVM, timestamp: bigint) {
    const clock = svm.getClock();
    clock.unixTimestamp = timestamp;
    svm.setClock(clock);
}
