import * as anchor from '@anchor-lang/core';
import { Keypair, LAMPORTS_PER_SOL, SystemProgram, sendAndConfirmTransaction, Transaction } from '@solana/web3.js';
import { BN } from 'bn.js';
import { assert } from 'chai';
import type { TransferSol } from '../target/types/transfer_sol.ts';

describe('Anchor: Transfer SOL', () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    const payer = provider.wallet as anchor.Wallet;
    const program = anchor.workspace.TransferSol as anchor.Program<TransferSol>;

    it('Transfer SOL with CPI', async () => {
        const recipient = Keypair.generate();

        await program.methods
            .transferSolWithCpi(new BN(LAMPORTS_PER_SOL))
            .accounts({
                payer: payer.publicKey,
                recipient: recipient.publicKey,
            })
            .rpc();

        const recipientBalance = await provider.connection.getBalance(recipient.publicKey);
        assert.equal(recipientBalance, LAMPORTS_PER_SOL);
    });

    it('Transfer SOL with Program', async () => {
        const payerAccount = Keypair.generate();
        const ix = SystemProgram.createAccount({
            fromPubkey: payer.publicKey,
            newAccountPubkey: payerAccount.publicKey,
            space: 0,
            lamports: LAMPORTS_PER_SOL, // 1 SOL
            programId: program.programId, // Program Owner, our program's address
        });

        const transaction = new Transaction().add(ix);

        await sendAndConfirmTransaction(provider.connection, transaction, [payer.payer, payerAccount]);

        const recipientAccount = Keypair.generate();
        await program.methods
            .transferSolWithProgram(new BN(LAMPORTS_PER_SOL))
            .accounts({
                payer: payerAccount.publicKey,
                recipient: recipientAccount.publicKey,
            })
            .rpc();

        const recipientBalance = await provider.connection.getBalance(recipientAccount.publicKey);
        assert.equal(recipientBalance, LAMPORTS_PER_SOL);
    });
});
