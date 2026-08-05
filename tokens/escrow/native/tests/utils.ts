import {
    type Address,
    appendTransactionMessageInstructions,
    createTransactionMessage,
    generateKeyPairSigner,
    getAddressEncoder,
    getProgramDerivedAddress,
    getU64Encoder,
    type Instruction,
    type KeyPairSigner,
    pipe,
    type ReadonlyUint8Array,
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

export async function sleep(seconds: number) {
    new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

export const expectRevert = async (promise: Promise<unknown>) => {
    try {
        await promise;
        throw new Error('Expected a revert');
    } catch {
        return;
    }
};

async function findAssociatedTokenAddress(mint: Address, owner: Address): Promise<Address> {
    const [associatedTokenAddress] = await findAssociatedTokenPda({
        mint,
        owner,
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });
    return associatedTokenAddress;
}

export const mintingTokens = async ({
    svm,
    payer,
    holder,
    mintKeypair,
    mintedAmount = 100,
    decimals = 6,
}: {
    svm: LiteSVM;
    payer: KeyPairSigner;
    holder: KeyPairSigner;
    mintKeypair: KeyPairSigner;
    mintedAmount?: number;
    decimals?: number;
}) => {
    async function processInstructions(instructions: Instruction[]) {
        const transactionMessage = pipe(
            createTransactionMessage({ version: 0 }),
            m => setTransactionMessageFeePayerSigner(payer, m),
            m => svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
            m => appendTransactionMessageInstructions(instructions, m),
        );
        const signedTx = await signTransactionMessageWithSigners(transactionMessage);

        const result = svm.sendTransaction(signedTx);
        if (result instanceof FailedTransactionMetadata) {
            throw new Error(`transaction failed: ${result.toString()}`);
        }
    }

    async function createMint(mint: KeyPairSigner, decimals: number) {
        const mintSize = BigInt(getMintSize());
        const lamports = svm.minimumBalanceForRentExemption(mintSize);

        await processInstructions([
            getCreateAccountInstruction({
                payer,
                newAccount: mint,
                space: mintSize,
                lamports,
                programAddress: TOKEN_PROGRAM_ADDRESS,
            }),
            getInitializeMint2Instruction({
                mint: mint.address,
                decimals,
                mintAuthority: payer.address,
                freezeAuthority: payer.address,
            }),
        ]);
    }

    async function createAssociatedTokenAccountIfNeeded(mint: Address, owner: Address) {
        const associatedToken = await findAssociatedTokenAddress(mint, owner);

        await processInstructions([
            getCreateAssociatedTokenIdempotentInstruction({
                payer,
                ata: associatedToken,
                owner,
                mint,
            }),
        ]);
    }

    async function mintTo(mint: Address, destination: Address, amount: number | bigint) {
        await processInstructions([
            getMintToInstruction({
                mint,
                token: destination,
                mintAuthority: payer,
                amount,
            }),
        ]);
    }

    // creator creates the mint
    await createMint(mintKeypair, decimals);

    // create holder token account
    await createAssociatedTokenAccountIfNeeded(mintKeypair.address, holder.address);

    // mint to holders token account
    await mintTo(
        mintKeypair.address,
        await findAssociatedTokenAddress(mintKeypair.address, holder.address),
        mintedAmount * 10 ** decimals,
    );
};

export interface TestValues {
    id: bigint;
    amountA: bigint;
    amountB: bigint;
    maker: KeyPairSigner;
    taker: KeyPairSigner;
    mintAKeypair: KeyPairSigner;
    mintBKeypair: KeyPairSigner;
    offer: Address;
    vault: Address;
    makerAccountA: Address;
    makerAccountB: Address;
    takerAccountA: Address;
    takerAccountB: Address;
    programId: Address;
}

type TestValuesDefaults = {
    [K in keyof TestValues]+?: TestValues[K];
};

function isLessThan(a: ReadonlyUint8Array, b: ReadonlyUint8Array): boolean {
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return a[i] < b[i];
    }
    return false;
}

export async function createValues(defaults?: TestValuesDefaults): Promise<TestValues> {
    const addressEncoder = getAddressEncoder();

    const programId = defaults?.programId ?? (await generateKeyPairSigner()).address;
    const id = defaults?.id ?? 0n;
    const maker = defaults?.maker ?? (await generateKeyPairSigner());
    const taker = defaults?.taker ?? (await generateKeyPairSigner());

    // Making sure tokens are in the right order. Only the mint(s) NOT
    // supplied by the caller are ever (re)generated, so a caller-provided
    // mint is never silently discarded.
    let mintAKeypair = defaults?.mintAKeypair ?? (await generateKeyPairSigner());
    let mintBKeypair = defaults?.mintBKeypair ?? (await generateKeyPairSigner());
    while (isLessThan(addressEncoder.encode(mintBKeypair.address), addressEncoder.encode(mintAKeypair.address))) {
        if (!defaults?.mintAKeypair) {
            mintAKeypair = await generateKeyPairSigner();
        } else if (!defaults?.mintBKeypair) {
            mintBKeypair = await generateKeyPairSigner();
        } else {
            throw new Error('mintAKeypair and mintBKeypair were both supplied out of the required address order');
        }
    }

    const [offer] = await getProgramDerivedAddress({
        programAddress: programId,
        seeds: ['offer', addressEncoder.encode(maker.address), getU64Encoder().encode(id)],
    });

    return {
        id,
        maker,
        taker,
        mintAKeypair,
        mintBKeypair,
        offer,
        vault: await findAssociatedTokenAddress(mintAKeypair.address, offer),
        makerAccountA: await findAssociatedTokenAddress(mintAKeypair.address, maker.address),
        makerAccountB: await findAssociatedTokenAddress(mintBKeypair.address, maker.address),
        takerAccountA: await findAssociatedTokenAddress(mintAKeypair.address, taker.address),
        takerAccountB: await findAssociatedTokenAddress(mintBKeypair.address, taker.address),
        amountA: defaults?.amountA ?? BigInt(4 * 10 ** 6),
        amountB: defaults?.amountB ?? BigInt(1 * 10 ** 6),
        programId,
    };
}
