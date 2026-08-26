import * as anchor from '@anchor-lang/core';
import {
    ASSOCIATED_TOKEN_PROGRAM_ID,
    createAssociatedTokenAccountInstruction,
    createInitializeMint2Instruction,
    createMintToInstruction,
    getAssociatedTokenAddressSync,
    MINT_SIZE,
    TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { PublicKey } from '@solana/web3.js';
import { getTokenDecoder } from '@solana-program/token';
import { LiteSVMProvider } from 'anchor-litesvm';
import { assert } from 'chai';
import { LiteSVM } from 'litesvm';
import IDL from '../target/idl/fundraiser.json';
import type { Fundraiser } from '../target/types/fundraiser';
import { expectAnchorError } from './utils';

const PROGRAM_ID = new PublicKey(IDL.address);

// Both floors in the program scale by 10^decimals, so at 6 decimals:
//   initialize: MIN_AMOUNT_TO_RAISE (3) whole tokens = 3_000_000 base units
//   contribute: 1 whole token                        = 1_000_000 base units
const DECIMALS = 6;
const ONE_TOKEN = 1_000_000;
const MIN_RAISE = 3 * ONE_TOKEN;

// The per-contributor cap is 10% of the target, so a campaign has to raise at
// least 10 tokens before any contribution can clear the 1-token floor without
// immediately breaching the cap. 30 tokens leaves room for both.
const TARGET = 30 * ONE_TOKEN;

describe('fundraiser minimum amounts', () => {
    const client = new LiteSVM();
    client.addProgramFromFile(PROGRAM_ID, 'target/deploy/fundraiser.so');
    const provider = new LiteSVMProvider(client);
    anchor.setProvider(provider);
    const wallet = provider.wallet as anchor.Wallet;
    const program = new anchor.Program<Fundraiser>(IDL, provider);

    const maker = anchor.web3.Keypair.generate();
    const floorMaker = anchor.web3.Keypair.generate();

    const fundraiser = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from('fundraiser'), maker.publicKey.toBuffer()],
        program.programId
    )[0];
    const floorFundraiser = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from('fundraiser'), floorMaker.publicKey.toBuffer()],
        program.programId
    )[0];
    const contributorAccount = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from('contributor'), fundraiser.toBuffer(), provider.publicKey.toBuffer()],
        program.programId
    )[0];

    const tokenBalance = (account: anchor.web3.PublicKey) =>
        getTokenDecoder().decode(client.getAccount(account).data).amount;

    let mint: PublicKey;
    let contributorAta: PublicKey;

    const initialize = (amount: number, campaignMaker: anchor.web3.Keypair, campaign: PublicKey) =>
        program.methods
            .initialize(new anchor.BN(amount), 1)
            .accountsPartial({
                maker: campaignMaker.publicKey,
                fundraiser: campaign,
                mintToRaise: mint,
                vault: getAssociatedTokenAddressSync(mint, campaign, true),
                systemProgram: anchor.web3.SystemProgram.programId,
                tokenProgram: TOKEN_PROGRAM_ID,
                associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            })
            .signers([campaignMaker])
            .rpc();

    const contribute = (amount: number) =>
        program.methods
            .contribute(new anchor.BN(amount))
            .accountsPartial({
                contributor: provider.publicKey,
                mintToRaise: mint,
                fundraiser,
                contributorAccount,
                contributorAta,
                vault: getAssociatedTokenAddressSync(mint, fundraiser, true),
                tokenProgram: TOKEN_PROGRAM_ID,
            })
            .rpc();

    it('sets up a 6-decimal mint and funds the contributor', async () => {
        client.airdrop(maker.publicKey, BigInt(anchor.web3.LAMPORTS_PER_SOL));
        client.airdrop(floorMaker.publicKey, BigInt(anchor.web3.LAMPORTS_PER_SOL));

        const mintKp = anchor.web3.Keypair.generate();
        mint = mintKp.publicKey;
        contributorAta = getAssociatedTokenAddressSync(mint, wallet.publicKey);

        const lamports = await provider.connection.getMinimumBalanceForRentExemption(MINT_SIZE);
        const setupTx = new anchor.web3.Transaction().add(
            anchor.web3.SystemProgram.createAccount({
                fromPubkey: wallet.publicKey,
                newAccountPubkey: mint,
                space: MINT_SIZE,
                lamports,
                programId: TOKEN_PROGRAM_ID,
            }),
            createInitializeMint2Instruction(mint, DECIMALS, provider.publicKey, provider.publicKey),
            createAssociatedTokenAccountInstruction(wallet.publicKey, contributorAta, wallet.publicKey, mint),
            createMintToInstruction(mint, contributorAta, provider.publicKey, 10 * ONE_TOKEN)
        );
        await provider.sendAndConfirm(setupTx, [mintKp]);

        assert.strictEqual(tokenBalance(contributorAta), BigInt(10 * ONE_TOKEN));
    });

    // Pre-fix the floor is MIN_AMOUNT_TO_RAISE.pow(decimals) = 3^6 = 729 base
    // units, so this amount sails through and no account is ever created.
    it('rejects a target below MIN_AMOUNT_TO_RAISE whole tokens', async () => {
        await expectAnchorError(initialize(MIN_RAISE - 1, floorMaker, floorFundraiser), 'InvalidAmount');

        assert.isNotOk(client.getAccount(floorFundraiser), 'no fundraiser account should have been created');
    });

    it('accepts a target of exactly MIN_AMOUNT_TO_RAISE whole tokens', async () => {
        await initialize(MIN_RAISE, floorMaker, floorFundraiser);

        const state = await program.account.fundraiser.fetch(floorFundraiser);
        assert.strictEqual(state.amountToRaise.toNumber(), MIN_RAISE);
    });

    it('initializes the campaign used for the contribution floor', async () => {
        await initialize(TARGET, maker, fundraiser);

        const state = await program.account.fundraiser.fetch(fundraiser);
        assert.strictEqual(state.amountToRaise.toNumber(), TARGET);
        assert.strictEqual(state.currentAmount.toNumber(), 0);
    });

    // Pre-fix the floor is 1_u64.pow(decimals) = 1 base unit, so every
    // non-zero contribution clears it and this transaction wrongly succeeds.
    it('rejects a contribution below one whole token', async () => {
        const vault = getAssociatedTokenAddressSync(mint, fundraiser, true);
        const vaultBefore = tokenBalance(vault);

        await expectAnchorError(contribute(ONE_TOKEN - 1), 'ContributionTooSmall');

        assert.strictEqual(tokenBalance(vault), vaultBefore, 'vault must not move on a rejected contribution');
        assert.isNotOk(client.getAccount(contributorAccount), 'no contributor account should have been created');
    });

    // 3 * 10^19 leaves u64, so the minimum target is not representable. With
    // overflow-checks enabled in the release profile that is a panic unless the
    // arithmetic is checked; SPL Token places no cap on a mint's decimals.
    it('rejects a high-decimal mint instead of overflowing', async () => {
        const wideMintKp = anchor.web3.Keypair.generate();
        const wideMint = wideMintKp.publicKey;
        const wideMaker = anchor.web3.Keypair.generate();
        client.airdrop(wideMaker.publicKey, BigInt(anchor.web3.LAMPORTS_PER_SOL));

        const wideFundraiser = anchor.web3.PublicKey.findProgramAddressSync(
            [Buffer.from('fundraiser'), wideMaker.publicKey.toBuffer()],
            program.programId
        )[0];

        const lamports = await provider.connection.getMinimumBalanceForRentExemption(MINT_SIZE);
        await provider.sendAndConfirm(
            new anchor.web3.Transaction().add(
                anchor.web3.SystemProgram.createAccount({
                    fromPubkey: wallet.publicKey,
                    newAccountPubkey: wideMint,
                    space: MINT_SIZE,
                    lamports,
                    programId: TOKEN_PROGRAM_ID,
                }),
                createInitializeMint2Instruction(wideMint, 19, provider.publicKey, provider.publicKey)
            ),
            [wideMintKp]
        );

        await expectAnchorError(
            program.methods
                .initialize(new anchor.BN('18446744073709551615'), 1)
                .accountsPartial({
                    maker: wideMaker.publicKey,
                    fundraiser: wideFundraiser,
                    mintToRaise: wideMint,
                    vault: getAssociatedTokenAddressSync(wideMint, wideFundraiser, true),
                    systemProgram: anchor.web3.SystemProgram.programId,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                })
                .signers([wideMaker])
                .rpc(),
            'InvalidAmount'
        );

        assert.isNotOk(client.getAccount(wideFundraiser), 'no fundraiser account should have been created');
    });

    it('accepts a contribution of exactly one whole token', async () => {
        client.expireBlockhash();
        const vault = getAssociatedTokenAddressSync(mint, fundraiser, true);
        const contributorBefore = tokenBalance(contributorAta);

        await contribute(ONE_TOKEN);

        assert.strictEqual(tokenBalance(vault), BigInt(ONE_TOKEN));
        assert.strictEqual(tokenBalance(contributorAta), contributorBefore - BigInt(ONE_TOKEN));

        const state = await program.account.fundraiser.fetch(fundraiser);
        assert.strictEqual(state.currentAmount.toNumber(), ONE_TOKEN);

        const contribution = await program.account.contributor.fetch(contributorAccount);
        assert.strictEqual(contribution.amount.toNumber(), ONE_TOKEN);
    });
});
