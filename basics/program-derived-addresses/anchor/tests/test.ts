import * as anchor from '@anchor-lang/core';
import { PublicKey } from '@solana/web3.js';
import { assert } from 'chai';
import type { ProgramDerivedAddressesProgram } from '../target/types/program_derived_addresses_program.ts';

describe('Anchor: PDAs', () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    const payer = provider.wallet as anchor.Wallet;
    const program = anchor.workspace.ProgramDerivedAddressesProgram as anchor.Program<ProgramDerivedAddressesProgram>;

    // PDA for the page visits account
    const [pageVisitPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from('page_visits'), payer.publicKey.toBuffer()],
        program.programId,
    );

    it('Create the page visits tracking PDA', async () => {
        await program.methods
            .createPageVisits()
            .accounts({
                payer: payer.publicKey,
            })
            .rpc();

        const pageVisits = await program.account.pageVisits.fetch(pageVisitPDA);
        assert.equal(pageVisits.pageVisits, 0);
    });

    it('Visit the page!', async () => {
        await program.methods
            .incrementPageVisits()
            .accounts({
                user: payer.publicKey,
            })
            .rpc();

        const pageVisits = await program.account.pageVisits.fetch(pageVisitPDA);
        assert.equal(pageVisits.pageVisits, 1);
    });

    it('Again visit the page!', async () => {
        await program.methods
            .incrementPageVisits()
            .accounts({
                user: payer.publicKey,
            })
            .rpc();

        const pageVisits = await program.account.pageVisits.fetch(pageVisitPDA);
        assert.equal(pageVisits.pageVisits, 2);
    });
});
