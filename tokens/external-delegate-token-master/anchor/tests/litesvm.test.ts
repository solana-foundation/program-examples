import * as anchor from '@anchor-lang/core';
import {
    createAssociatedTokenAccountInstruction,
    createInitializeMint2Instruction,
    createMintToInstruction,
    getAssociatedTokenAddressSync,
    MINT_SIZE,
    TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { getTokenDecoder } from '@solana-program/token';
import { LiteSVMProvider } from 'anchor-litesvm';
import { expect } from 'chai';
import { LiteSVM } from 'litesvm';
import IDL from '../target/idl/external_delegate_token_master.json';
import type { ExternalDelegateTokenMaster } from '../target/types/external_delegate_token_master';

const PROGRAM_ID = new PublicKey(IDL.address);

describe('External Delegate Token Master Tests', () => {
    const client = new LiteSVM();
    client.addProgramFromFile(PROGRAM_ID, 'target/deploy/external_delegate_token_master.so');
    const provider = new LiteSVMProvider(client);
    anchor.setProvider(provider);
    const wallet = provider.wallet as anchor.Wallet;
    const program = new anchor.Program<ExternalDelegateTokenMaster>(IDL, provider);

    const authority = Keypair.generate();
    const userAccount = Keypair.generate();
    const [userPda] = PublicKey.findProgramAddressSync([userAccount.publicKey.toBuffer()], program.programId);

    client.airdrop(authority.publicKey, BigInt(LAMPORTS_PER_SOL));

    it('should initialize user account', async () => {
        await program.methods
            .initialize()
            .accountsPartial({
                userAccount: userAccount.publicKey,
                authority: authority.publicKey,
                systemProgram: SystemProgram.programId,
            })
            .signers([authority, userAccount])
            .rpc();

        const account = await program.account.userAccount.fetch(userAccount.publicKey);
        expect(account.authority.toString()).to.equal(authority.publicKey.toString());
        expect(account.ethereumAddress).to.deep.equal(new Array(20).fill(0));
    });

    it('should set ethereum address', async () => {
        const ethereumAddress = Buffer.from('1C8cd0c38F8DE35d6056c7C7aBFa7e65D260E816', 'hex');

        await program.methods
            .setEthereumAddress(Array.from(ethereumAddress))
            .accountsPartial({
                userAccount: userAccount.publicKey,
                authority: authority.publicKey,
            })
            .signers([authority])
            .rpc();

        const account = await program.account.userAccount.fetch(userAccount.publicKey);
        expect(account.ethereumAddress).to.deep.equal(Array.from(ethereumAddress));
    });

    it('should perform authority transfer', async () => {
        const mintKeypair = Keypair.generate();
        const mint = mintKeypair.publicKey;
        const userTokenAccount = getAssociatedTokenAddressSync(mint, userPda, true);
        const recipient = Keypair.generate();
        const recipientTokenAccount = getAssociatedTokenAddressSync(mint, recipient.publicKey);

        const lamports = await provider.connection.getMinimumBalanceForRentExemption(MINT_SIZE);
        const setupTx = new Transaction().add(
            SystemProgram.createAccount({
                fromPubkey: wallet.publicKey,
                newAccountPubkey: mint,
                space: MINT_SIZE,
                lamports,
                programId: TOKEN_PROGRAM_ID,
            }),
            createInitializeMint2Instruction(mint, 6, authority.publicKey, null),
            createAssociatedTokenAccountInstruction(wallet.publicKey, userTokenAccount, userPda, mint),
            createAssociatedTokenAccountInstruction(wallet.publicKey, recipientTokenAccount, recipient.publicKey, mint),
            createMintToInstruction(mint, userTokenAccount, authority.publicKey, 1_000_000_000),
        );
        await provider.sendAndConfirm!(setupTx, [mintKeypair, authority]);

        await program.methods
            .authorityTransfer(new anchor.BN(250))
            .accountsPartial({
                userAccount: userAccount.publicKey,
                authority: authority.publicKey,
                userTokenAccount,
                recipientTokenAccount,
                userPda,
                tokenProgram: TOKEN_PROGRAM_ID,
            })
            .signers([authority])
            .rpc();

        const recipientBalance = getTokenDecoder().decode(client.getAccount(recipientTokenAccount)!.data).amount;
        expect(recipientBalance).to.equal(BigInt(250));

        const userBalance = getTokenDecoder().decode(client.getAccount(userTokenAccount)!.data).amount;
        expect(userBalance).to.equal(BigInt(1_000_000_000 - 250));
    });
});
