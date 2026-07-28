import { describe, it } from 'node:test';
import * as anchor from '@anchor-lang/core';
import {
    AccountLayout,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    createAssociatedTokenAccountInstruction,
    createInitializeMintInstruction,
    createInitializeTransferHookInstruction,
    createMintToInstruction,
    createTransferCheckedWithTransferHookInstruction,
    ExtensionType,
    getAssociatedTokenAddressSync,
    getMintLen,
    TOKEN_2022_PROGRAM_ID,
} from '@solana/spl-token';
import { Keypair, PublicKey, SystemProgram, Transaction, type TransactionInstruction } from '@solana/web3.js';
import { BankrunProvider } from 'anchor-bankrun';
import { assert } from 'chai';
import { startAnchor } from 'solana-bankrun';
import IDL from '../target/idl/transfer_switch.json';
import type { TransferSwitch } from '../target/types/transfer_switch';

const PROGRAM_ID = new PublicKey(IDL.address);

const expectRevert = async (promise: Promise<any>) => {
    try {
        await promise;
        throw new Error('Expected a revert');
    } catch {
        return;
    }
};

describe('Transfer switch', async () => {
    const context = await startAnchor('', [{ name: 'transfer_switch', programId: PROGRAM_ID }], []);
    const provider = new BankrunProvider(context);

    const _wallet = provider.wallet as anchor.Wallet;
    const program = new anchor.Program<TransferSwitch>(IDL, provider);
    const connection = provider.connection;

    const payer = provider.context.payer;
    const client = provider.context.banksClient;

    // Generate keypair to use as address for the transfer-hook enabled mint
    const mint = Keypair.generate();
    const decimals = 9;

    function newUser(): [Keypair, PublicKey, TransactionInstruction] {
        const user = Keypair.generate();
        const userTokenAccount = getAssociatedTokenAddressSync(
            mint.publicKey,
            user.publicKey,
            false,
            TOKEN_2022_PROGRAM_ID,
        );
        const createUserTokenAccountIx = createAssociatedTokenAccountInstruction(
            payer.publicKey,
            userTokenAccount,
            user.publicKey,
            mint.publicKey,
            TOKEN_2022_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID,
        );

        return [user, userTokenAccount, createUserTokenAccountIx];
    }

    // admin config address
    const adminConfigAddress = PublicKey.findProgramAddressSync([Buffer.from('admin-config')], PROGRAM_ID)[0];

    // helper for getting wallet switch
    const walletTransferSwitchAddress = (wallet: PublicKey) =>
        PublicKey.findProgramAddressSync([wallet.toBuffer()], PROGRAM_ID)[0];

    // sender
    const [sender, senderTokenAccount, senderTokenAccountCreateIx] = newUser();

    it('Create Mint Account with Transfer Hook Extension', async () => {
        const extensions = [ExtensionType.TransferHook];
        const mintLen = getMintLen(extensions);
        const lamports = await provider.connection.getMinimumBalanceForRentExemption(mintLen);

        const transaction = new Transaction().add(
            SystemProgram.createAccount({
                fromPubkey: payer.publicKey,
                newAccountPubkey: mint.publicKey,
                space: mintLen,
                lamports: lamports,
                programId: TOKEN_2022_PROGRAM_ID,
            }),
            createInitializeTransferHookInstruction(
                mint.publicKey,
                payer.publicKey,
                program.programId, // Transfer Hook Program ID
                TOKEN_2022_PROGRAM_ID,
            ),
            createInitializeMintInstruction(mint.publicKey, decimals, payer.publicKey, null, TOKEN_2022_PROGRAM_ID),
        );

        transaction.recentBlockhash = context.lastBlockhash;
        transaction.sign(payer, mint);

        await client.processTransaction(transaction);
    });

    // Create the two token accounts for the transfer-hook enabled mint
    // Fund the sender token account with 100 tokens
    it('Create Token Accounts and Mint Tokens', async () => {
        // 100 tokens
        const amount = 100 * 10 ** decimals;

        const transaction = new Transaction().add(
            senderTokenAccountCreateIx, // create sender token account
            createMintToInstruction(
                mint.publicKey,
                senderTokenAccount,
                payer.publicKey,
                amount,
                [],
                TOKEN_2022_PROGRAM_ID,
            ),
        );

        transaction.recentBlockhash = context.lastBlockhash;
        transaction.sign(payer);

        await client.processTransaction(transaction);
    });

    // Account to store extra accounts required by the transfer hook instruction
    // This will be called for every mint
    //
    it('Create ExtraAccountMetaList Account', async () => {
        await program.methods
            .initializeExtraAccountMetasList()
            .accounts({
                payer: payer.publicKey,
                tokenMint: mint.publicKey,
            })
            .signers([payer])
            .rpc();
    });

    // Set the account that controls the switches for the wallet
    it('Configure an admin', async () => {
        await program.methods
            .configureAdmin()
            .accounts({
                admin: payer.publicKey,
                newAdmin: payer.publicKey,
            })
            .signers([payer])
            .rpc();

        const adminConfig = await program.account.adminConfig.fetch(adminConfigAddress);
        assert(adminConfig.isInitialised === true, 'admin config not initialised');
        assert(adminConfig.admin.toBase58() === payer.publicKey.toBase58(), 'admin does not match');
    });

    // Account to store extra accounts required by the transfer hook instruction
    it('turn transfers off for sender', async () => {
        await program.methods
            .switch(false)
            .accountsPartial({
                wallet: sender.publicKey,
                admin: payer.publicKey,
            })
            .signers([payer])
            .rpc();

        const walletSwitch = await program.account.transferSwitch.fetch(walletTransferSwitchAddress(sender.publicKey));

        assert(walletSwitch.wallet.toBase58() === sender.publicKey.toBase58(), 'wallet key does not match');
        assert(!walletSwitch.on, 'wallet switch not set to false');
    });

    it('Try transfer, should fail!', async () => {
        // 1 tokens
        const amount = 1 * 10 ** decimals;
        const bigIntAmount = BigInt(amount);

        const [recipient, recipientTokenAccount, recipientTokenAccountCreateIx] = newUser();

        // create the recipient token account ahead of the transfer,
        //
        let transaction = new Transaction().add(
            recipientTokenAccountCreateIx, // create recipient token account
        );

        transaction.recentBlockhash = context.lastBlockhash;
        transaction.sign(payer, recipient);

        client.processTransaction(transaction);

        // Standard token transfer instruction
        const transferInstruction = await createTransferCheckedWithTransferHookInstruction(
            connection,
            senderTokenAccount,
            mint.publicKey,
            recipientTokenAccount,
            sender.publicKey,
            bigIntAmount,
            decimals,
            [],
            'confirmed',
            TOKEN_2022_PROGRAM_ID,
        );

        transaction = new Transaction().add(
            transferInstruction, // transfer instruction
        );

        transaction.recentBlockhash = context.lastBlockhash;
        transaction.sign(payer, sender);

        // expect the transaction to fail
        //
        expectRevert(client.processTransaction(transaction));

        const recipientTokenAccountData = (await client.getAccount(recipientTokenAccount)).data;
        const recipientBalance = AccountLayout.decode(recipientTokenAccountData).amount;

        assert(recipientBalance === BigInt(0), 'transfer was successful');
    });

    // Account to store extra accounts required by the transfer hook instruction
    it('turn on for sender!', async () => {
        await program.methods
            .switch(true)
            .accountsPartial({
                wallet: sender.publicKey,
                admin: payer.publicKey,
            })
            .signers([payer])
            .rpc();

        const walletSwitch = await program.account.transferSwitch.fetch(walletTransferSwitchAddress(sender.publicKey));

        assert(walletSwitch.wallet.toBase58() === sender.publicKey.toBase58(), 'wallet key does not match');
        assert(walletSwitch.on, 'wallet switch not set to true');
    });

    it('Send successfully', async () => {
        // 1 tokens
        const amount = 1 * 10 ** decimals;
        const bigIntAmount = BigInt(amount);

        const [_recipient, recipientTokenAccount, recipientTokenAccountCreateIx] = newUser();

        // Standard token transfer instruction
        const transferInstruction = await createTransferCheckedWithTransferHookInstruction(
            connection,
            senderTokenAccount,
            mint.publicKey,
            recipientTokenAccount,
            sender.publicKey,
            bigIntAmount,
            decimals,
            [],
            'confirmed',
            TOKEN_2022_PROGRAM_ID,
        );

        const transaction = new Transaction().add(recipientTokenAccountCreateIx, transferInstruction);

        transaction.recentBlockhash = context.lastBlockhash;
        transaction.sign(payer, sender);

        await client.processTransaction(transaction);

        const recipientTokenAccountData = (await client.getAccount(recipientTokenAccount)).data;

        const recipientBalance = AccountLayout.decode(recipientTokenAccountData).amount;

        assert(recipientBalance === bigIntAmount, 'transfer was not successful');
    });
});
