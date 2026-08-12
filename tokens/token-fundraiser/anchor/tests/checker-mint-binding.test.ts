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
import { LiteSVMProvider } from 'anchor-litesvm';
import { assert, expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { LiteSVM } from 'litesvm';
import IDL from '../target/idl/fundraiser.json';
import type { Fundraiser } from '../target/types/fundraiser';

use(chaiAsPromised);

const PROGRAM_ID = new PublicKey(IDL.address);

describe('fundraiser checker mint binding', () => {
    const client = new LiteSVM();
    client.addProgramFromFile(PROGRAM_ID, 'target/deploy/fundraiser.so');
    const provider = new LiteSVMProvider(client);
    anchor.setProvider(provider);
    const wallet = provider.wallet as anchor.Wallet;
    const program = new anchor.Program<Fundraiser>(IDL, provider);

    const maker = anchor.web3.Keypair.generate();

    const fundraiser = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from('fundraiser'), maker.publicKey.toBuffer()],
        program.programId,
    )[0];

    const AMOUNT_TO_RAISE = 3_000_000; // 3 tokens at 6 decimals

    let realMint: PublicKey;
    let fakeMint: PublicKey;

    it('sets up a real campaign mint and a maker-controlled fake mint', async () => {
        client.airdrop(maker.publicKey, BigInt(anchor.web3.LAMPORTS_PER_SOL));

        const realMintKp = anchor.web3.Keypair.generate();
        realMint = realMintKp.publicKey;
        const fakeMintKp = anchor.web3.Keypair.generate();
        fakeMint = fakeMintKp.publicKey;

        const lamports = await provider.connection.getMinimumBalanceForRentExemption(MINT_SIZE);
        const setupTx = new anchor.web3.Transaction().add(
            anchor.web3.SystemProgram.createAccount({
                fromPubkey: wallet.publicKey,
                newAccountPubkey: realMint,
                space: MINT_SIZE,
                lamports,
                programId: TOKEN_PROGRAM_ID,
            }),
            createInitializeMint2Instruction(realMint, 6, provider.publicKey, provider.publicKey),
            anchor.web3.SystemProgram.createAccount({
                fromPubkey: wallet.publicKey,
                newAccountPubkey: fakeMint,
                space: MINT_SIZE,
                lamports,
                programId: TOKEN_PROGRAM_ID,
            }),
            createInitializeMint2Instruction(fakeMint, 6, maker.publicKey, maker.publicKey),
        );
        await provider.sendAndConfirm(setupTx, [realMintKp, fakeMintKp]);
    });

    it('initializes the campaign against the real mint', async () => {
        const vault = getAssociatedTokenAddressSync(realMint, fundraiser, true);

        await program.methods
            .initialize(new anchor.BN(AMOUNT_TO_RAISE), 0)
            .accountsPartial({
                maker: maker.publicKey,
                fundraiser,
                mintToRaise: realMint,
                vault,
                systemProgram: anchor.web3.SystemProgram.programId,
                tokenProgram: TOKEN_PROGRAM_ID,
                associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            })
            .signers([maker])
            .rpc();

        const state = await program.account.fundraiser.fetch(fundraiser);
        assert.strictEqual(state.mintToRaise.toBase58(), realMint.toBase58());
    });

    it('rejects check_contributions against a mint other than the one recorded', async () => {
        const fakeVault = getAssociatedTokenAddressSync(fakeMint, fundraiser, true);
        const makerFakeAta = getAssociatedTokenAddressSync(fakeMint, maker.publicKey);

        const fundTx = new anchor.web3.Transaction().add(
            createAssociatedTokenAccountInstruction(maker.publicKey, fakeVault, fundraiser, fakeMint),
            createAssociatedTokenAccountInstruction(maker.publicKey, makerFakeAta, maker.publicKey, fakeMint),
            createMintToInstruction(fakeMint, fakeVault, maker.publicKey, AMOUNT_TO_RAISE),
        );
        await provider.sendAndConfirm(fundTx, [maker]);

        const checkPromise = program.methods
            .checkContributions()
            .accountsPartial({
                maker: maker.publicKey,
                mintToRaise: fakeMint,
                fundraiser,
                makerAta: makerFakeAta,
                vault: fakeVault,
                tokenProgram: TOKEN_PROGRAM_ID,
            })
            .signers([maker])
            .rpc();

        await expect(checkPromise).to.eventually.be.rejectedWith(anchor.AnchorError, 'ConstraintHasOne');

        const state = await program.account.fundraiser.fetch(fundraiser);
        assert.strictEqual(state.mintToRaise.toBase58(), realMint.toBase58());
    });
});
