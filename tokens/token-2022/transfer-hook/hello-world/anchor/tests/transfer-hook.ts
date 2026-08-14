import type { Program } from '@anchor-lang/core';
import * as anchor from '@anchor-lang/core';
import {
    ASSOCIATED_TOKEN_PROGRAM_ID,
    createAssociatedTokenAccountInstruction,
    createMintToInstruction,
    createTransferCheckedWithTransferHookInstruction,
    getAssociatedTokenAddressSync,
    TOKEN_2022_PROGRAM_ID,
} from '@solana/spl-token';
import { Keypair, SendTransactionError, sendAndConfirmTransaction, Transaction } from '@solana/web3.js';
import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import type { TransferHook } from '../target/types/transfer_hook';

use(chaiAsPromised);

describe('transfer-hook', () => {
    // Configure the client to use the local cluster.
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const program = anchor.workspace.TransferHook as Program<TransferHook>;
    const wallet = provider.wallet as anchor.Wallet;
    const connection = provider.connection;

    // Generate keypair to use as address for the transfer-hook enabled mint
    const mint = new Keypair();
    const decimals = 2;

    // Sender token account address
    const sourceTokenAccount = getAssociatedTokenAddressSync(
        mint.publicKey,
        wallet.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
    );

    // Recipient token account address
    const recipient = Keypair.generate();
    const destinationTokenAccount = getAssociatedTokenAddressSync(
        mint.publicKey,
        recipient.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
    );

    it('Create Mint with Transfer Hook Extension', async () => {
        const transactionSignature = await program.methods
            .initialize(decimals)
            .accounts({ mintAccount: mint.publicKey })
            .signers([mint])
            .rpc({ skipPreflight: true });
        console.log('Your transaction signature', transactionSignature);
    });

    // Create the two token accounts for the transfer-hook enabled mint
    // Fund the sender token account with 100 tokens
    it('Create Token Accounts and Mint Tokens', async () => {
        // 100 tokens
        const amount = 100 * 10 ** decimals;

        const transaction = new Transaction().add(
            createAssociatedTokenAccountInstruction(
                wallet.publicKey,
                sourceTokenAccount,
                wallet.publicKey,
                mint.publicKey,
                TOKEN_2022_PROGRAM_ID,
                ASSOCIATED_TOKEN_PROGRAM_ID,
            ),
            createAssociatedTokenAccountInstruction(
                wallet.publicKey,
                destinationTokenAccount,
                recipient.publicKey,
                mint.publicKey,
                TOKEN_2022_PROGRAM_ID,
                ASSOCIATED_TOKEN_PROGRAM_ID,
            ),
            createMintToInstruction(
                mint.publicKey,
                sourceTokenAccount,
                wallet.publicKey,
                amount,
                [],
                TOKEN_2022_PROGRAM_ID,
            ),
        );

        const txSig = await sendAndConfirmTransaction(connection, transaction, [wallet.payer], { skipPreflight: true });

        console.log(`Transaction Signature: ${txSig}`);
    });

    // Account to store extra accounts required by the transfer hook instruction
    it('Create ExtraAccountMetaList Account', async () => {
        const initializeExtraAccountMetaListInstruction = await program.methods
            .initializeExtraAccountMetaList()
            .accounts({
                mint: mint.publicKey,
            })
            .instruction();

        const transaction = new Transaction().add(initializeExtraAccountMetaListInstruction);

        const txSig = await sendAndConfirmTransaction(provider.connection, transaction, [wallet.payer], {
            skipPreflight: true,
            commitment: 'confirmed',
        });
        console.log('Transaction Signature:', txSig);
    });

    it('Transfer Hook with Extra Account Meta', async () => {
        // 1 tokens
        const amount = 1 * 10 ** decimals;
        const bigIntAmount = BigInt(amount);

        // Standard token transfer instruction
        const transferInstruction = await createTransferCheckedWithTransferHookInstruction(
            connection,
            sourceTokenAccount,
            mint.publicKey,
            destinationTokenAccount,
            wallet.publicKey,
            bigIntAmount,
            decimals,
            [],
            'confirmed',
            TOKEN_2022_PROGRAM_ID,
        );

        const transaction = new Transaction().add(transferInstruction);

        const txSig = await sendAndConfirmTransaction(connection, transaction, [wallet.payer], { skipPreflight: true });
        console.log('Transfer Signature:', txSig);
    });

    it('Try call transfer hook without transfer', async () => {
        const transferHookIx = await program.methods
            .transferHook(new anchor.BN(1))
            .accounts({
                sourceToken: sourceTokenAccount,
                mint: mint.publicKey,
                destinationToken: destinationTokenAccount,
                owner: wallet.publicKey,
            })
            .instruction();

        const transaction = new Transaction().add(transferHookIx);

        const sendPromise = sendAndConfirmTransaction(connection, transaction, [wallet.payer], {
            skipPreflight: false,
        });

        await expect(sendPromise).to.eventually.be.rejectedWith(SendTransactionError, program.idl.errors[0].msg);
    });
});
