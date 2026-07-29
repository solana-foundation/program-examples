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

export const mintingTokens = ({
    svm,
    payer,
    holder,
    mintKeypair,
    mintedAmount = 100,
    decimals = 6,
}: {
    svm: LiteSVM;
    payer: Keypair;
    holder: Signer;
    mintKeypair: Keypair;
    mintedAmount?: number;
    decimals?: number;
}) => {
    function processTransaction(transaction: Transaction, signers: Keypair[]) {
        transaction.recentBlockhash = svm.latestBlockhash();
        transaction.sign(...signers);

        const result = svm.sendTransaction(transaction);
        if (result instanceof FailedTransactionMetadata) {
            throw new Error(`transaction failed: ${result.toString()}`);
        }
    }

    function createMint(mint: Keypair, decimals: number) {
        const lamports = svm.minimumBalanceForRentExemption(BigInt(MINT_SIZE));

        const transaction = new Transaction().add(
            SystemProgram.createAccount({
                fromPubkey: payer.publicKey,
                newAccountPubkey: mint.publicKey,
                space: MINT_SIZE,
                lamports: new BN(lamports.toString()).toNumber(),
                programId: TOKEN_PROGRAM_ID,
            }),
            createInitializeMint2Instruction(
                mint.publicKey,
                decimals,
                payer.publicKey,
                payer.publicKey,
                TOKEN_PROGRAM_ID,
            ),
        );
        processTransaction(transaction, [payer, mint]);
    }

    function createAssociatedTokenAccountIfNeeded(mint: PublicKey, owner: PublicKey) {
        const associatedToken = getAssociatedTokenAddressSync(mint, owner, true);

        const transaction = new Transaction().add(
            createAssociatedTokenAccountIdempotentInstruction(
                payer.publicKey,
                associatedToken,
                owner,
                mint,
                TOKEN_PROGRAM_ID,
                ASSOCIATED_TOKEN_PROGRAM_ID,
            ),
        );
        processTransaction(transaction, [payer]);
    }

    function mintTo(mint: PublicKey, destination: PublicKey, amount: number | bigint) {
        const transaction = new Transaction().add(
            createMintToInstruction(mint, destination, payer.publicKey, amount, [], TOKEN_PROGRAM_ID),
        );
        processTransaction(transaction, [payer]);
    }

    // creator creates the mint
    createMint(mintKeypair, decimals);

    // create holder token account
    createAssociatedTokenAccountIfNeeded(mintKeypair.publicKey, holder.publicKey);

    // mint to holders token account
    mintTo(
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
    offerBump: number;
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

    const [offer, offerBump] = PublicKey.findProgramAddressSync(
        [Buffer.from('offer'), maker.publicKey.toBuffer(), Buffer.from(id.toArray('le', 8))],
        programId,
    );

    return {
        id,
        maker,
        taker,
        mintAKeypair,
        mintBKeypair,
        offer,
        offerBump,
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
