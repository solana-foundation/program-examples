import {
    ASSOCIATED_TOKEN_PROGRAM_ID,
    createAssociatedTokenAccountIdempotentInstruction,
    createInitializeMint2Instruction,
    createMintToInstruction,
    getAssociatedTokenAddressSync,
    MINT_SIZE,
    TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { Keypair, PublicKey, type Signer, SystemProgram, Transaction } from '@solana/web3.js';
import BN from 'bn.js';
import type { ProgramTestContext } from 'solana-bankrun';

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

export const mintingTokens = async ({
    context,
    holder,
    mintKeypair,
    mintedAmount = 100,
    decimals = 6,
}: {
    context: ProgramTestContext;
    holder: Signer;
    mintKeypair: Keypair;
    mintedAmount?: number;
    decimals?: number;
}) => {
    async function createMint(context: ProgramTestContext, mint: Keypair, decimals: number) {
        const rent = await context.banksClient.getRent();

        const lamports = rent.minimumBalance(BigInt(MINT_SIZE));

        const transaction = new Transaction().add(
            SystemProgram.createAccount({
                fromPubkey: context.payer.publicKey,
                newAccountPubkey: mint.publicKey,
                space: MINT_SIZE,
                lamports: new BN(lamports.toString()).toNumber(),
                programId: TOKEN_PROGRAM_ID,
            }),
            createInitializeMint2Instruction(
                mint.publicKey,
                decimals,
                context.payer.publicKey,
                context.payer.publicKey,
                TOKEN_PROGRAM_ID,
            ),
        );
        transaction.recentBlockhash = context.lastBlockhash;
        transaction.sign(context.payer, mint);

        await context.banksClient.processTransaction(transaction);
    }

    async function createAssociatedTokenAccountIfNeeded(
        context: ProgramTestContext,
        mint: PublicKey,
        owner: PublicKey,
    ) {
        const associatedToken = getAssociatedTokenAddressSync(mint, owner, true);

        const rent = await context.banksClient.getRent();

        rent.minimumBalance(BigInt(MINT_SIZE));

        const transaction = new Transaction().add(
            createAssociatedTokenAccountIdempotentInstruction(
                context.payer.publicKey,
                associatedToken,
                owner,
                mint,
                TOKEN_PROGRAM_ID,
                ASSOCIATED_TOKEN_PROGRAM_ID,
            ),
        );
        transaction.recentBlockhash = context.lastBlockhash;
        transaction.sign(context.payer);

        await context.banksClient.processTransaction(transaction);
    }

    async function mintTo(
        context: ProgramTestContext,
        mint: PublicKey,
        destination: PublicKey,
        amount: number | bigint,
    ) {
        const transaction = new Transaction().add(
            createMintToInstruction(mint, destination, context.payer.publicKey, amount, [], TOKEN_PROGRAM_ID),
        );
        transaction.recentBlockhash = context.lastBlockhash;
        transaction.sign(context.payer);

        await context.banksClient.processTransaction(transaction);
    }

    // creator creates the mint
    await createMint(context, mintKeypair, decimals);

    // create holder token account
    await createAssociatedTokenAccountIfNeeded(context, mintKeypair.publicKey, holder.publicKey);

    // mint to holders token account
    await mintTo(
        context,
        mintKeypair.publicKey,
        getAssociatedTokenAddressSync(mintKeypair.publicKey, holder.publicKey, true),
        mintedAmount * 10 ** decimals,
    );
};

export interface TestValues {
    id: BN;
    amountA: BN;
    amountB: BN;
    maker: Keypair;
    taker: Keypair;
    mintAKeypair: Keypair;
    mintBKeypair: Keypair;
    offer: PublicKey;
    vault: PublicKey;
    makerAccountA: PublicKey;
    makerAccountB: PublicKey;
    takerAccountA: PublicKey;
    takerAccountB: PublicKey;
    programId: PublicKey;
}

type TestValuesDefaults = {
    [K in keyof TestValues]+?: TestValues[K];
};

export function createValues(defaults?: TestValuesDefaults): TestValues {
    const programId = PublicKey.unique();
    const id = defaults?.id || new BN(0);
    const maker = Keypair.generate();
    const taker = Keypair.generate();

    // Making sure tokens are in the right order
    const mintAKeypair = Keypair.generate();
    let mintBKeypair = Keypair.generate();
    while (new BN(mintBKeypair.publicKey.toBytes()).lt(new BN(mintAKeypair.publicKey.toBytes()))) {
        mintBKeypair = Keypair.generate();
    }

    const offer = PublicKey.findProgramAddressSync(
        [Buffer.from('offer'), maker.publicKey.toBuffer(), Buffer.from(id.toArray('le', 8))],
        programId,
    )[0];

    return {
        id,
        maker,
        taker,
        mintAKeypair,
        mintBKeypair,
        offer,
        vault: getAssociatedTokenAddressSync(mintAKeypair.publicKey, offer, true),
        makerAccountA: getAssociatedTokenAddressSync(mintAKeypair.publicKey, maker.publicKey, true),
        makerAccountB: getAssociatedTokenAddressSync(mintBKeypair.publicKey, maker.publicKey, true),
        takerAccountA: getAssociatedTokenAddressSync(mintAKeypair.publicKey, taker.publicKey, true),
        takerAccountB: getAssociatedTokenAddressSync(mintBKeypair.publicKey, taker.publicKey, true),
        amountA: new BN(4 * 10 ** 6),
        amountB: new BN(1 * 10 ** 6),
        programId,
    };
}
