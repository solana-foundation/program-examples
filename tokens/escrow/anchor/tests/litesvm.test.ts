import { randomBytes } from 'node:crypto';
import anchor from '@anchor-lang/core';

const BN = anchor.BN;

import {
    createAssociatedTokenAccountIdempotentInstruction,
    createInitializeMint2Instruction,
    createMintToInstruction,
    getAccount,
    getAssociatedTokenAddressSync,
    getMinimumBalanceForRentExemptMint,
    MINT_SIZE,
    TOKEN_2022_PROGRAM_ID,
    type TOKEN_PROGRAM_ID,
    unpackAccount,
} from '@solana/spl-token';
import { LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, type TransactionInstruction } from '@solana/web3.js';
import { makeKeypairs } from '@solana-developers/helpers';
import { LiteSVMProvider } from 'anchor-litesvm';
import { assert } from 'chai';
import { LiteSVM } from 'litesvm';
import type { Escrow } from '../target/types/escrow';

const TOKEN_PROGRAM: typeof TOKEN_2022_PROGRAM_ID | typeof TOKEN_PROGRAM_ID = TOKEN_2022_PROGRAM_ID;

import IDL from '../target/idl/escrow.json' with { type: 'json' };

const PROGRAM_ID = new PublicKey(IDL.address);

const getRandomBigNumber = (size = 8) => {
    return new BN(randomBytes(size));
};

describe('Escrow LiteSVM example', () => {
    let provider: LiteSVMProvider;
    let connection: anchor.web3.Connection;
    let program: anchor.Program<Escrow>;

    // We're going to reuse these accounts across multiple tests
    const accounts: Record<string, PublicKey> = {
        tokenProgram: TOKEN_PROGRAM,
    };

    const [alice, bob, tokenMintA, tokenMintB] = makeKeypairs(4);

    before(
        'Creates Alice and Bob accounts, 2 token mints, and associated token accounts for both tokens for both users',
        async () => {
            const client = new LiteSVM();
            client.addProgramFromFile(PROGRAM_ID, 'target/deploy/escrow.so');
            provider = new LiteSVMProvider(client);
            client.airdrop(provider.publicKey, BigInt(100 * LAMPORTS_PER_SOL));
            connection = provider.connection;
            program = new anchor.Program<Escrow>(IDL, provider);

            const [aliceTokenAccountA, aliceTokenAccountB, bobTokenAccountA, bobTokenAccountB] = [alice, bob].flatMap(
                keypair =>
                    [tokenMintA, tokenMintB].map(mint =>
                        getAssociatedTokenAddressSync(mint.publicKey, keypair.publicKey, false, TOKEN_PROGRAM),
                    ),
            );

            // Airdrops to users, and creates two tokens mints 'A' and 'B'"
            const minimumLamports = await getMinimumBalanceForRentExemptMint(connection);

            const sendSolInstructions: Array<TransactionInstruction> = [alice, bob].map(account =>
                SystemProgram.transfer({
                    fromPubkey: provider.publicKey,
                    toPubkey: account.publicKey,
                    lamports: 10 * LAMPORTS_PER_SOL,
                }),
            );

            const createMintInstructions: Array<TransactionInstruction> = [tokenMintA, tokenMintB].map(mint =>
                SystemProgram.createAccount({
                    fromPubkey: provider.publicKey,
                    newAccountPubkey: mint.publicKey,
                    lamports: minimumLamports,
                    space: MINT_SIZE,
                    programId: TOKEN_PROGRAM,
                }),
            );

            // Make tokenA and tokenB mints, mint tokens and create ATAs
            const mintTokensInstructions: Array<TransactionInstruction> = [
                {
                    mint: tokenMintA.publicKey,
                    authority: alice.publicKey,
                    ata: aliceTokenAccountA,
                },
                {
                    mint: tokenMintB.publicKey,
                    authority: bob.publicKey,
                    ata: bobTokenAccountB,
                },
            ].flatMap(mintDetails => [
                createInitializeMint2Instruction(mintDetails.mint, 6, mintDetails.authority, null, TOKEN_PROGRAM),
                createAssociatedTokenAccountIdempotentInstruction(
                    provider.publicKey,
                    mintDetails.ata,
                    mintDetails.authority,
                    mintDetails.mint,
                    TOKEN_PROGRAM,
                ),
                createMintToInstruction(
                    mintDetails.mint,
                    mintDetails.ata,
                    mintDetails.authority,
                    1_000_000_000,
                    [],
                    TOKEN_PROGRAM,
                ),
            ]);

            // Add all these instructions to our transaction
            const tx = new Transaction();
            tx.instructions = [...sendSolInstructions, ...createMintInstructions, ...mintTokensInstructions];

            await provider.sendAndConfirm(tx, [tokenMintA, tokenMintB, alice, bob]);

            // Save the accounts for later use
            accounts.maker = alice.publicKey;
            accounts.taker = bob.publicKey;
            accounts.tokenMintA = tokenMintA.publicKey;
            accounts.makerTokenAccountA = aliceTokenAccountA;
            accounts.takerTokenAccountA = bobTokenAccountA;
            accounts.tokenMintB = tokenMintB.publicKey;
            accounts.makerTokenAccountB = aliceTokenAccountB;
            accounts.takerTokenAccountB = bobTokenAccountB;
        },
    );

    const tokenAOfferedAmount = new BN(1_000_000);
    const tokenBWantedAmount = new BN(1_000_000);

    // We'll call this function from multiple tests, so let's seperate it out
    const make = async () => {
        // Pick a random ID for the offer we'll make
        const offerId = getRandomBigNumber();

        // Then determine the account addresses we'll use for the offer and the vault
        const offer = PublicKey.findProgramAddressSync(
            [Buffer.from('offer'), accounts.maker.toBuffer(), offerId.toArrayLike(Buffer, 'le', 8)],
            program.programId,
        )[0];

        const vault = getAssociatedTokenAddressSync(accounts.tokenMintA, offer, true, TOKEN_PROGRAM);

        accounts.offer = offer;
        accounts.vault = vault;

        const _transactionSignature = await program.methods
            .makeOffer(offerId, tokenAOfferedAmount, tokenBWantedAmount)
            .accounts({ ...accounts })
            .signers([alice])
            .rpc();

        // Check our vault contains the tokens offered
        const vaultAccount = await getAccount(connection, vault, 'processed', TOKEN_PROGRAM);
        const vaultBalance = new BN(vaultAccount.amount.toString());
        assert(vaultBalance.eq(tokenAOfferedAmount));

        // Check our Offer account contains the correct data
        const offerAccount = await program.account.offer.fetch(offer);

        assert(offerAccount.maker.equals(alice.publicKey));
        assert(offerAccount.tokenMintA.equals(accounts.tokenMintA));
        assert(offerAccount.tokenMintB.equals(accounts.tokenMintB));
        assert(offerAccount.tokenBWantedAmount.eq(tokenBWantedAmount));
    };

    // We'll call this function from multiple tests, so let's seperate it out
    const take = async () => {
        const _transactionSignature = await program.methods
            .takeOffer()
            .accounts({ ...accounts })
            .signers([bob])
            .rpc();

        // Check the offered tokens are now in Bob's account
        // (note: there is no before balance as Bob didn't have any offered tokens before the transaction)
        const bobTokenAccountInfo = await connection.getAccountInfo(accounts.takerTokenAccountA);
        const bobTokenAccount = unpackAccount(accounts.takerTokenAccountA, bobTokenAccountInfo, TOKEN_PROGRAM);

        const bobTokenAccountBalanceAfter = new BN(bobTokenAccount.amount.toString());
        assert(bobTokenAccountBalanceAfter.eq(tokenAOfferedAmount));

        // Check the wanted tokens are now in Alice's account
        // (note: there is no before balance as Alice didn't have any wanted tokens before the transaction)
        const aliceTokenAccountInfo = await connection.getAccountInfo(accounts.makerTokenAccountB);
        const aliceTokenAccount = unpackAccount(accounts.makerTokenAccountB, aliceTokenAccountInfo, TOKEN_PROGRAM);

        const aliceTokenAccountBalanceAfter = new BN(aliceTokenAccount.amount.toString());
        assert(aliceTokenAccountBalanceAfter.eq(tokenBWantedAmount));
    };

    it('Puts the tokens Alice offers into the vault when Alice makes an offer', async () => {
        await make();
    });

    it("Puts the tokens from the vault into Bob's account, and gives Alice Bob's tokens, when Bob takes an offer", async () => {
        await take();
    });
});
