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
import { assert } from 'chai';
import { LiteSVM } from 'litesvm';
import IDL from '../target/idl/fundraiser.json';
import type { Fundraiser } from '../target/types/fundraiser';
import { expectAnchorError } from './utils';

const PROGRAM_ID = new PublicKey(IDL.address);
const SECONDS_PER_DAY = 86400n;

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

        // duration=1 day. This suite can warp its own clock, so it covers
        // the full lifecycle (see the tests below).
        const tx = await program.methods
            .initialize(new BN(30000000), 1)
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
        // Per-contributor cap is 3_000_000 (10% of target); contributor
        // holds 2_000_000 already. Must run before the deadline warp below.
        const vault = getAssociatedTokenAddressSync(mint, fundraiser, true);

        await expectAnchorError(
            program.methods
                .contribute(new BN(2000000))
                .accountsPartial({
                    contributor: provider.publicKey,
                    fundraiser,
                    contributorAccount: contributor,
                    contributorAta: contributorATA,
                    vault,
                    tokenProgram: TOKEN_PROGRAM_ID,
                })
                .rpc(),
            'MaximumContributionsReached',
        );
    });

    // Pre-fix this fails with AccountNotInitialized, not a wrongly-
    // succeeding refund - contribute() was broken from its first call, so
    // no Contributor account ever formed. Same bug, different symptom.
    it('Refund is rejected while the fundraiser is still active', async () => {
        const vault = getAssociatedTokenAddressSync(mint, fundraiser, true);
        const vaultBalanceBefore = tokenBalance(vault);

        await expectAnchorError(
            program.methods
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
                .rpc(),
            'FundraiserNotEnded',
        );

        assert.strictEqual(tokenBalance(vault), vaultBalanceBefore, 'rejected refund must not move any funds');
    });

    it('Check contributions - Robustness Test', async () => {
        // Only 2_000_000 has been contributed against a 30_000_000 target.
        // Time-independent - checker.rs has no duration check.
        const vault = getAssociatedTokenAddressSync(mint, fundraiser, true);

        await expectAnchorError(
            program.methods
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
                .rpc(),
            'TargetNotMet',
        );
    });

    // Warps to the exact deadline boundary (not past it) to pin the
    // off-by-one directly: contribute must reject exactly here.
    it('Fundraiser closes to contributions once the duration has elapsed', async () => {
        const fundraiserAccount = await program.account.fundraiser.fetch(fundraiser);
        const deadline =
            BigInt(fundraiserAccount.timeStarted.toString()) + BigInt(fundraiserAccount.duration) * SECONDS_PER_DAY;

        const clock = client.getClock();
        clock.unixTimestamp = deadline;
        client.setClock(clock);
        // Avoids a duplicate-transaction rejection from an earlier identical call.
        client.expireBlockhash();

        const vault = getAssociatedTokenAddressSync(mint, fundraiser, true);

        // 1_000_000 keeps the per-contributor cap check passing, so only
        // the time check can reject this - proving it's the deadline.
        await expectAnchorError(
            program.methods
                .contribute(new BN(1000000))
                .accountsPartial({
                    contributor: provider.publicKey,
                    fundraiser,
                    contributorAccount: contributor,
                    contributorAta: contributorATA,
                    vault,
                    tokenProgram: TOKEN_PROGRAM_ID,
                })
                .rpc(),
            'FundraiserEnded',
        );
    });

    it('Refund Contributions', async () => {
        // Runs after the deadline warp above, so refund's time check now passes.
        const vault = getAssociatedTokenAddressSync(mint, fundraiser, true);

        const contributorAccount = await program.account.contributor.fetch(contributor);
        console.log('\nContributor balance', contributorAccount.amount.toString());

        // Same duplicate-transaction hazard as above.
        client.expireBlockhash();

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

        assert.strictEqual(tokenBalance(vault), 0n, 'vault should be fully drained back to the contributor');
        assert.strictEqual(
            tokenBalance(contributorATA),
            10_000_000n,
            "contributor's full original balance should be restored",
        );
        assert.isNull(client.getAccount(contributor), 'the Contributor account should be closed');
    });
});
