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

export async function sendInstructions(svm: LiteSVM, payer: KeyPairSigner, instructions: readonly Instruction[]) {
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

export async function mintingTokens({
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
}) {
    const [holderAta] = await findAssociatedTokenPda({
        mint: mintKeypair.address,
        owner: holder.address,
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });

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

    await sendInstructions(svm, payer, [
        getCreateAssociatedTokenIdempotentInstruction({
            payer,
            ata: holderAta,
            owner: holder.address,
            mint: mintKeypair.address,
        }),
    ]);

    await sendInstructions(svm, payer, [
        getMintToInstruction({
            mint: mintKeypair.address,
            token: holderAta,
            mintAuthority: payer,
            amount: BigInt(mintedAmount) * 10n ** BigInt(decimals),
        }),
    ]);
}

export interface TestValues {
    id: bigint;
    amountA: bigint;
    amountB: bigint;
    maker: KeyPairSigner;
    taker: KeyPairSigner;
    mintAKeypair: KeyPairSigner;
    mintBKeypair: KeyPairSigner;
    offer: Address;
    offerBump: number;
    vault: Address;
    makerAccountA: Address;
    makerAccountB: Address;
    takerAccountA: Address;
    takerAccountB: Address;
    programId: Address;
}

function addressValue(address: Address): bigint {
    return addressEncoder.encode(address).reduce((total, byte) => (total << 8n) | BigInt(byte), 0n);
}

export async function createValues(defaults?: { id?: bigint }): Promise<TestValues> {
    const programId = (await generateKeyPairSigner()).address;
    const id = defaults?.id ?? 0n;
    const maker = await generateKeyPairSigner();
    const taker = await generateKeyPairSigner();

    // Making sure tokens are in the right order
    const mintAKeypair = await generateKeyPairSigner();
    let mintBKeypair = await generateKeyPairSigner();
    while (addressValue(mintBKeypair.address) < addressValue(mintAKeypair.address)) {
        mintBKeypair = await generateKeyPairSigner();
    }

    const [offer, offerBump] = await getProgramDerivedAddress({
        programAddress: programId,
        seeds: ['offer', addressEncoder.encode(maker.address), getU64Encoder().encode(id)],
    });

    const findAta = (mint: Address, owner: Address) =>
        findAssociatedTokenPda({ mint, owner, tokenProgram: TOKEN_PROGRAM_ADDRESS });

    const [vault] = await findAta(mintAKeypair.address, offer);
    const [makerAccountA] = await findAta(mintAKeypair.address, maker.address);
    const [makerAccountB] = await findAta(mintBKeypair.address, maker.address);
    const [takerAccountA] = await findAta(mintAKeypair.address, taker.address);
    const [takerAccountB] = await findAta(mintBKeypair.address, taker.address);

    return {
        id,
        maker,
        taker,
        mintAKeypair,
        mintBKeypair,
        offer,
        offerBump,
        vault,
        makerAccountA,
        makerAccountB,
        takerAccountA,
        takerAccountB,
        amountA: 4_000_000n,
        amountB: 1_000_000n,
        programId,
    };
}
