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

const PROGRAM_ID = new PublicKey(IDL.address);
const SECONDS_PER_DAY = 86400n;

// Asserts that `promise` rejects with the given Anchor custom error code
// (e.g. 'FundraiserNotEnded'), not just "something failed" - see the same
// helper in tests/fundraiser.ts for why this matters.
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

        // duration=1 (day). Unlike fundraiser.ts, this suite can warp its
        // own clock deterministically, so it covers the full lifecycle:
        // contribute while active, refund rejected while active, contribute
        // rejected once the deadline passes, and refund succeeding once it
        // has (see the tests below, in that order).
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
        // Contributor already holds 2_000_000, and the per-contributor cap
        // is 10% of the 30_000_000 target = 3_000_000. This 2_000_000
        // attempt would push the total to 4_000_000, over the cap. Must run
        // before the deadline warp below - once the deadline passes,
        // contribute() rejects on the time check first, which would test
        // the wrong thing.
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

    // Confirms refund() is correctly gated on FundraiserNotEnded while the
    // fundraiser is genuinely still active. Note this doesn't reproduce the
    // original bug in isolation: with a realistic nonzero duration,
    // contribute() itself was broken from the very first call (see the
    // "Fundraiser closes..." test below for a direct, isolated repro of
    // that half), so pre-fix this call actually fails with
    // AccountNotInitialized instead (no Contributor account ever got
    // created) - a different symptom of the same root cause, not the
    // "refund wrongly succeeds" behavior that specifically required the
    // original tests' degenerate duration=0 setup. Either way, this only
    // passes once refund is correctly gated on FundraiserNotEnded
    // specifically, so it still fails before the fix and passes after.
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

    // This is the other half of the original bug: contribute() used to only
    // succeed AFTER the deadline (backwards). Warp to the exact boundary
    // (elapsed_days == duration) rather than some point further out, so this
    // pins the boundary itself - a boundary that's off by one in either
    // direction would flip this test's result.
    it('Fundraiser closes to contributions once the duration has elapsed', async () => {
        const fundraiserAccount = await program.account.fundraiser.fetch(fundraiser);
        const deadline =
            BigInt(fundraiserAccount.timeStarted.toString()) + BigInt(fundraiserAccount.duration) * SECONDS_PER_DAY;

        const clock = client.getClock();
        clock.unixTimestamp = deadline;
        client.setClock(clock);
        // Without this, the next contribute() call would build a
        // byte-identical transaction to an earlier one (same instruction,
        // accounts, and fee payer) and get silently rejected as
        // already-processed rather than actually being evaluated.
        client.expireBlockhash();

        const vault = getAssociatedTokenAddressSync(mint, fundraiser, true);

        // 1_000_000, not 2_000_000: the contributor holds 2_000_000 already
        // and the per-contributor cap is 3_000_000, so 2_000_000 would hit
        // MaximumContributionsReached regardless of the time check - that
        // would make this test pass whether or not the deadline fix is
        // present. 1_000_000 keeps the cap check passing
        // (2_000_000 + 1_000_000 = 3_000_000 <= 3_000_000), so the time
        // check is the only thing that can reject it.
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
        // Runs after the deadline warp above, so elapsed_days (1) >=
        // duration (1) now holds and the target (30_000_000) was never met
        // (only 2_000_000 was ever contributed) - the intended happy path.
        const vault = getAssociatedTokenAddressSync(mint, fundraiser, true);

        const contributorAccount = await program.account.contributor.fetch(contributor);
        console.log('\nContributor balance', contributorAccount.amount.toString());

        // Same instruction/accounts/fee-payer shape as the earlier rejected
        // refund attempt - same duplicate-transaction hazard as above.
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
