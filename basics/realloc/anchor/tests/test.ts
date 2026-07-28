import type { Program } from '@anchor-lang/core';
import * as anchor from '@anchor-lang/core';
import { Keypair } from '@solana/web3.js';
import { assert } from 'chai';
import type { AnchorRealloc } from '../target/types/anchor_realloc.ts';

describe('Anchor: realloc', () => {
    // Configure the client to use the local cluster.
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    const payer = provider.wallet as anchor.Wallet;
    const connection = provider.connection;

    const program = anchor.workspace.AnchorRealloc as Program<AnchorRealloc>;

    const messageAccount = new Keypair();

    // helper function to check the account data and message
    async function checkAccount(publicKey, expectedMessage) {
        const accountInfo = await connection.getAccountInfo(publicKey);
        const accountData = await program.account.message.fetch(publicKey);

        // 8 bytes for the discriminator,
        // 4 bytes for the length of the message,
        // and the length of the message
        assert.equal(accountInfo.data.length, 8 + 4 + expectedMessage.length);
        assert.equal(accountData.message, expectedMessage);
    }

    it('Is initialized!', async () => {
        const input = 'hello';

        await program.methods
            .initialize(input)
            .accounts({
                payer: payer.publicKey,
                messageAccount: messageAccount.publicKey,
            })
            .signers([messageAccount])
            .rpc();

        await checkAccount(messageAccount.publicKey, input);
    });

    it('Update', async () => {
        const input = 'hello world';

        await program.methods
            .update(input)
            .accounts({
                payer: payer.publicKey,
                messageAccount: messageAccount.publicKey,
            })
            .rpc();

        await checkAccount(messageAccount.publicKey, input);
    });

    it('Again update', async () => {
        const input = 'hi';

        await program.methods
            .update(input)
            .accounts({
                payer: payer.publicKey,
                messageAccount: messageAccount.publicKey,
            })
            .rpc();

        await checkAccount(messageAccount.publicKey, input);
    });
});
