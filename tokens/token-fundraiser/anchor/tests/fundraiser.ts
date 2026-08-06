import type { Program } from '@anchor-lang/core';
import * as anchor from '@anchor-lang/core';
import type NodeWallet from '@anchor-lang/core/dist/cjs/nodewallet';
import {
    ASSOCIATED_TOKEN_PROGRAM_ID,
    createMint,
    getAssociatedTokenAddressSync,
    getOrCreateAssociatedTokenAccount,
    mintTo,
    TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import BN from 'bn.js';
import { assert } from 'chai';
import type { Fundraiser } from '../target/types/fundraiser';

// Asserts that `promise` rejects with the given Anchor custom error code (e.g.
// 'FundraiserNotEnded'), not just "something failed" - a promise that fails
// for an unrelated reason (wrong seeds, missing account) would otherwise pass
// just as easily as the specific check we actually mean to be testing.
const expectAnchorError = async (promise: Promise<unknown>, code: string) => {
    let caught: any;
    try {
        await promise;
    } catch (error) {
        caught = error;
    }
    assert.isDefined(caught, `expected the transaction to fail with ${code}`);
    assert.strictEqual(caught?.error?.errorCode?.code, code, `expected ${code}, got: ${caught}`);
};

describe('fundraiser', () => {
    // Configure the client to use the local cluster.
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const program = anchor.workspace.Fundraiser as Program<Fundraiser>;

    const maker = anchor.web3.Keypair.generate();

    let mint: anchor.web3.PublicKey;

    let contributorATA: anchor.web3.PublicKey;

    let makerATA: anchor.web3.PublicKey;

    const wallet = provider.wallet as NodeWallet;

    const fundraiser = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from('fundraiser'), maker.publicKey.toBuffer()],
        program.programId,
    )[0];

    const contributor = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from('contributor'), fundraiser.toBuffer(), provider.publicKey.toBuffer()],
        program.programId,
    )[0];

    const confirm = async (signature: string): Promise<string> => {
        const block = await provider.connection.getLatestBlockhash();
        await provider.connection.confirmTransaction({
            signature,
            ...block,
        });
        return signature;
    };

    it('Test Preparation', async () => {
        const airdrop = await provider.connection
            .requestAirdrop(maker.publicKey, 1 * anchor.web3.LAMPORTS_PER_SOL)
            .then(confirm);
        console.log('\nAirdropped 1 SOL to maker', airdrop);

        mint = await createMint(provider.connection, wallet.payer, provider.publicKey, provider.publicKey, 6);
        console.log('Mint created', mint.toBase58());

        contributorATA = (
            await getOrCreateAssociatedTokenAccount(provider.connection, wallet.payer, mint, wallet.publicKey)
        ).address;

        makerATA = (await getOrCreateAssociatedTokenAccount(provider.connection, wallet.payer, mint, maker.publicKey))
            .address;

        const mintTx = await mintTo(
            provider.connection,
            wallet.payer,
            mint,
            contributorATA,
            provider.publicKey,
            1_000_000_0,
        );
        console.log('Minted 10 tokens to contributor', mintTx);
    });

    it('Initialize Fundaraiser', async () => {
        const vault = getAssociatedTokenAddressSync(mint, fundraiser, true);

        // duration=1 (day). This suite runs against a real validator with no
        // way to fast-forward its clock, so it can only ever exercise "still
        // within the window" (contribute succeeds, refund correctly rejects)
        // - the post-deadline happy path is covered in litesvm.test.ts,
        // which CAN warp its clock deterministically.
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
            .rpc()
            .then(confirm);

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
            .rpc()
            .then(confirm);

        console.log('\nContributed to fundraiser', tx);
        console.log('Your transaction signature', tx);
        console.log('Vault balance', (await provider.connection.getTokenAccountBalance(vault)).value.amount);

        const contributorAccount = await program.account.contributor.fetch(contributor);
        console.log('Contributor balance', contributorAccount.amount.toString());
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
            .rpc()
            .then(confirm);

        console.log('\nContributed to fundraiser', tx);
        console.log('Your transaction signature', tx);
        console.log('Vault balance', (await provider.connection.getTokenAccountBalance(vault)).value.amount);

        const contributorAccount = await program.account.contributor.fetch(contributor);
        console.log('Contributor balance', contributorAccount.amount.toString());
    });

    it('Contribute to Fundraiser - Robustness Test', async () => {
        // Contributor already holds 2_000_000, and the per-contributor cap is
        // 10% of the 30_000_000 target = 3_000_000. This 2_000_000 attempt
        // would push the total to 4_000_000, over the cap.
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
                .rpc()
                .then(confirm),
            'MaximumContributionsReached',
        );
    });

    it('Check contributions - Robustness Test', async () => {
        // Only 2_000_000 has been contributed against a 30_000_000 target.
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
                .rpc()
                .then(confirm),
            'TargetNotMet',
        );
    });

    // This suite runs against a real solana-test-validator, which has no way
    // to fast-forward its clock, so it can't exercise "refund succeeds once
    // the deadline has passed" - see litesvm.test.ts for that happy path
    // (and for a direct, isolated repro of the "contribute only works past
    // the deadline" half of the original bug, at the exact boundary).
    // What this test verifies without any time travel: a refund attempted
    // while the fundraiser is still genuinely active must be rejected, and
    // must not move any funds. Pre-fix this call actually fails with
    // AccountNotInitialized rather than a wrongly-succeeding refund - with a
    // realistic nonzero duration, contribute() was broken from its very
    // first call, so no Contributor account was ever created for refund to
    // act on. Same root cause, different symptom; either way this only
    // passes once refund is correctly gated on FundraiserNotEnded.
    it('Refund is rejected while the fundraiser is still active', async () => {
        const vault = getAssociatedTokenAddressSync(mint, fundraiser, true);
        const vaultBalanceBefore = (await provider.connection.getTokenAccountBalance(vault)).value.amount;

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
                .rpc()
                .then(confirm),
            'FundraiserNotEnded',
        );

        const vaultBalanceAfter = (await provider.connection.getTokenAccountBalance(vault)).value.amount;
        assert.strictEqual(vaultBalanceAfter, vaultBalanceBefore, 'rejected refund must not move any funds');
    });
});
