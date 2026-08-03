import type { Program } from '@anchor-lang/core';
import * as anchor from '@anchor-lang/core';
import { Keypair } from '@solana/web3.js';
import { assert } from 'chai';
import type { CounterAnchor } from '../target/types/counter_anchor.ts';

describe('Anchor: Counter', () => {
    // Configure the client to use the local cluster.
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    const payer = provider.wallet as anchor.Wallet;

    const program = anchor.workspace.CounterAnchor as Program<CounterAnchor>;

    // Generate a new keypair for the counter account
    const counterKeypair = new Keypair();

    it('Initialize Counter', async () => {
        await program.methods
            .initializeCounter()
            .accounts({
                counter: counterKeypair.publicKey,
                payer: payer.publicKey,
            })
            .signers([counterKeypair])
            .rpc();

        const currentCount = await program.account.counter.fetch(counterKeypair.publicKey);

        assert(currentCount.count.toNumber() === 0, 'Expected initialized count to be 0');
    });

    it('Increment Counter', async () => {
        await program.methods.increment().accounts({ counter: counterKeypair.publicKey }).rpc();

        const currentCount = await program.account.counter.fetch(counterKeypair.publicKey);

        assert(currentCount.count.toNumber() === 1, 'Expected  count to be 1');
    });

    it('Increment Counter Again', async () => {
        await program.methods.increment().accounts({ counter: counterKeypair.publicKey }).rpc();

        const currentCount = await program.account.counter.fetch(counterKeypair.publicKey);

        assert(currentCount.count.toNumber() === 2, 'Expected  count to be 2');
    });
});
