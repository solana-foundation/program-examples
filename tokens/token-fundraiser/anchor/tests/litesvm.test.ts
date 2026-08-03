import * as anchor from '@anchor-lang/core';
import {
    AccountLayout,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    createAssociatedTokenAccountInstruction,
    createInitializeMint2Instruction,
    createMintToInstruction,
    getAssociatedTokenAddressSync,
    MINT_SIZE,
    TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { PublicKey } from '@solana/web3.js';
import { LiteSVMProvider } from 'anchor-litesvm';
import BN from 'bn.js';
import { LiteSVM } from 'litesvm';
import IDL from '../target/idl/fundraiser.json';
import type { Fundraiser } from '../target/types/fundraiser';

const PROGRAM_ID = new PublicKey(IDL.address);

describe('fundraiser litesvm', () => {
    const client = new LiteSVM();
    client.addProgramFromFile(PROGRAM_ID, 'target/deploy/fundraiser.so');
    const provider = new LiteSVMProvider(client);
    anchor.setProvider(provider);
    const wallet = provider.wallet as anchor.Wallet;
    const program = new anchor.Program<Fundraiser>(IDL, provider);

    const maker = anchor.web3.Keypair.generate();

    let mint: anchor.web3.PublicKey;

    let contributorATA: anchor.web3.PublicKey;

    let makerATA: anchor.web3.PublicKey;

    const fundraiser = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from('fundraiser'), maker.publicKey.toBuffer()],
        program.programId,
    )[0];

    const contributor = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from('contributor'), fundraiser.toBuffer(), provider.publicKey.toBuffer()],
        program.programId,
    )[0];

    const tokenBalance = (account: anchor.web3.PublicKey) =>
        AccountLayout.decode(client.getAccount(account).data).amount;

    it('Test Preparation', async () => {
        client.airdrop(maker.publicKey, BigInt(anchor.web3.LAMPORTS_PER_SOL));
        console.log('\nAirdropped 1 SOL to maker');

        const mintKeypair = anchor.web3.Keypair.generate();
        mint = mintKeypair.publicKey;
        contributorATA = getAssociatedTokenAddressSync(mint, wallet.publicKey);
        makerATA = getAssociatedTokenAddressSync(mint, maker.publicKey);

        const lamports = await provider.connection.getMinimumBalanceForRentExemption(MINT_SIZE);
        const setupTx = new anchor.web3.Transaction().add(
            anchor.web3.SystemProgram.createAccount({
                fromPubkey: wallet.publicKey,
                newAccountPubkey: mint,
                space: MINT_SIZE,
                lamports,
                programId: TOKEN_PROGRAM_ID,
            }),
            createInitializeMint2Instruction(mint, 6, provider.publicKey, provider.publicKey),
            createAssociatedTokenAccountInstruction(wallet.publicKey, contributorATA, wallet.publicKey, mint),
            createAssociatedTokenAccountInstruction(wallet.publicKey, makerATA, maker.publicKey, mint),
            createMintToInstruction(mint, contributorATA, provider.publicKey, 1_000_000_0),
        );
        const mintTx = await provider.sendAndConfirm(setupTx, [mintKeypair]);
        console.log('Mint created', mint.toBase58());
        console.log('Minted 10 tokens to contributor', mintTx);
    });

    it('Initialize Fundaraiser', async () => {
        const vault = getAssociatedTokenAddressSync(mint, fundraiser, true);

        const tx = await program.methods
            .initialize(new BN(30000000), 0)
            .accountsPartial({
                maker: maker.publicKey,
                fundraiser,
                mintToRaise: mint,
                vault,
                systemProgram: anchor.web3.SystemProgram.programId,
                tokenProgram: TOKEN_PROGRAM_ID,
                associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            })
            .signers([maker])
            .rpc();

        console.log('\nInitialized fundraiser Account');
        console.log('Your transaction signature', tx);
    });

    it('Contribute to Fundraiser', async () => {
        const vault = getAssociatedTokenAddressSync(mint, fundraiser, true);

        const tx = await program.methods
            .contribute(new BN(1000000))
            .accountsPartial({
                contributor: provider.publicKey,
                fundraiser,
                contributorAccount: contributor,
                contributorAta: contributorATA,
                vault,
                tokenProgram: TOKEN_PROGRAM_ID,
            })
            .rpc();

        console.log('\nContributed to fundraiser', tx);
        console.log('Your transaction signature', tx);
        console.log('Vault balance', tokenBalance(vault).toString());

        const contributorAccount = await program.account.contributor.fetch(contributor);
        console.log('Contributor balance', contributorAccount.amount.toString());
    });
    it('Contribute to Fundraiser', async () => {
        client.expireBlockhash();
        const vault = getAssociatedTokenAddressSync(mint, fundraiser, true);

        const tx = await program.methods
            .contribute(new BN(1000000))
            .accountsPartial({
                contributor: provider.publicKey,
                fundraiser,
                contributorAccount: contributor,
                contributorAta: contributorATA,
                vault,
                tokenProgram: TOKEN_PROGRAM_ID,
            })
            .rpc();

        console.log('\nContributed to fundraiser', tx);
        console.log('Your transaction signature', tx);
        console.log('Vault balance', tokenBalance(vault).toString());

        const contributorAccount = await program.account.contributor.fetch(contributor);
        console.log('Contributor balance', contributorAccount.amount.toString());
    });

    it('Contribute to Fundraiser - Robustness Test', async () => {
        try {
            const vault = getAssociatedTokenAddressSync(mint, fundraiser, true);

            const tx = await program.methods
                .contribute(new BN(2000000))
                .accountsPartial({
                    contributor: provider.publicKey,
                    fundraiser,
                    contributorAccount: contributor,
                    contributorAta: contributorATA,
                    vault,
                    tokenProgram: TOKEN_PROGRAM_ID,
                })
                .rpc();

            console.log('\nContributed to fundraiser', tx);
            console.log('Your transaction signature', tx);
            console.log('Vault balance', tokenBalance(vault).toString());
        } catch (error) {
            console.log('\nError contributing to fundraiser');
            console.log(error.msg);
        }
    });

    it('Check contributions - Robustness Test', async () => {
        try {
            const vault = getAssociatedTokenAddressSync(mint, fundraiser, true);

            const tx = await program.methods
                .checkContributions()
                .accountsPartial({
                    maker: maker.publicKey,
                    mintToRaise: mint,
                    fundraiser,
                    makerAta: makerATA,
                    vault,
                    tokenProgram: TOKEN_PROGRAM_ID,
                })
                .signers([maker])
                .rpc();

            console.log('\nChecked contributions');
            console.log('Your transaction signature', tx);
            console.log('Vault balance', tokenBalance(vault).toString());
        } catch (error) {
            console.log('\nError checking contributions');
            console.log(error.msg);
        }
    });

    it('Refund Contributions', async () => {
        const vault = getAssociatedTokenAddressSync(mint, fundraiser, true);

        const contributorAccount = await program.account.contributor.fetch(contributor);
        console.log('\nContributor balance', contributorAccount.amount.toString());

        const tx = await program.methods
            .refund()
            .accountsPartial({
                contributor: provider.publicKey,
                maker: maker.publicKey,
                mintToRaise: mint,
                fundraiser,
                contributorAccount: contributor,
                contributorAta: contributorATA,
                vault,
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: anchor.web3.SystemProgram.programId,
            })
            .rpc();

        console.log('\nRefunded contributions', tx);
        console.log('Your transaction signature', tx);
        console.log('Vault balance', tokenBalance(vault).toString());
    });
});
