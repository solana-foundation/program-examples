import anchor from '@anchor-lang/core';
import {
    Keypair,
    LAMPORTS_PER_SOL,
    PublicKey,
    SystemProgram,
    Transaction,
    TransactionInstruction,
} from '@solana/web3.js';
import { assert } from 'chai';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';
import Idl from '../target/idl/transfer_sol.json' with { type: 'json' };

describe('LiteSVM: Transfer SOL', () => {
    const svm = new LiteSVM();
    const programId = new PublicKey(Idl.address);
    const coder = new anchor.BorshCoder(Idl as anchor.Idl);
    const payer = Keypair.generate();
    svm.airdrop(payer.publicKey, BigInt(5 * LAMPORTS_PER_SOL));

    const programFilePath = new URL('../target/deploy/transfer_sol.so', import.meta.url).pathname;
    svm.addProgramFromFile(programId, programFilePath);

    it('Transfer SOL with CPI', () => {
        const recipient = Keypair.generate();

        const ixArgs = {
            amount: new anchor.BN(LAMPORTS_PER_SOL),
        };
        const data = coder.instruction.encode('transfer_sol_with_cpi', ixArgs);
        const ix = new TransactionInstruction({
            keys: [
                { pubkey: payer.publicKey, isSigner: true, isWritable: true },
                { pubkey: recipient.publicKey, isSigner: false, isWritable: true },
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            ],
            programId,
            data,
        });

        const tx = new Transaction().add(ix);
        tx.feePayer = payer.publicKey;
        tx.recentBlockhash = svm.latestBlockhash();
        tx.sign(payer);
        svm.sendTransaction(tx);

        const recipientAcc = svm.getAccount(recipient.publicKey);
        assert.equal(recipientAcc.lamports, LAMPORTS_PER_SOL);
    });

    it('Transfer SOL with Program', () => {
        const payerAccount = Keypair.generate();
        const ixPayer = SystemProgram.createAccount({
            fromPubkey: payer.publicKey,
            newAccountPubkey: payerAccount.publicKey,
            lamports: LAMPORTS_PER_SOL,
            space: 0,
            programId,
        });
        const txPayer = new Transaction().add(ixPayer);
        txPayer.feePayer = payer.publicKey;
        txPayer.recentBlockhash = svm.latestBlockhash();
        txPayer.sign(payer, payerAccount);
        svm.sendTransaction(txPayer);
        svm.expireBlockhash();

        const recipientAccount = Keypair.generate();

        const ixArgs = {
            amount: new anchor.BN(LAMPORTS_PER_SOL),
        };
        const data = coder.instruction.encode('transfer_sol_with_program', ixArgs);
        const ix = new TransactionInstruction({
            keys: [
                { pubkey: payerAccount.publicKey, isSigner: true, isWritable: true },
                {
                    pubkey: recipientAccount.publicKey,
                    isSigner: false,
                    isWritable: true,
                },
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            ],
            programId,
            data,
        });

        const tx = new Transaction().add(ix);
        tx.feePayer = payer.publicKey;
        tx.recentBlockhash = svm.latestBlockhash();
        tx.sign(payer, payerAccount);
        svm.sendTransaction(tx);

        const recipientAcc = svm.getAccount(recipientAccount.publicKey);
        assert.equal(recipientAcc.lamports, LAMPORTS_PER_SOL);
    });

    it("An attacker cannot drain another user's program-owned account", () => {
        const victimAccount = Keypair.generate();
        const ixVictim = SystemProgram.createAccount({
            fromPubkey: payer.publicKey,
            newAccountPubkey: victimAccount.publicKey,
            lamports: LAMPORTS_PER_SOL,
            space: 0,
            programId,
        });
        const txVictim = new Transaction().add(ixVictim);
        txVictim.feePayer = payer.publicKey;
        txVictim.recentBlockhash = svm.latestBlockhash();
        txVictim.sign(payer, victimAccount);
        svm.sendTransaction(txVictim);
        svm.expireBlockhash();

        // The attacker never has victimAccount's private key. They mark it
        // as a non-signer in the instruction and only sign with their own
        // (unrelated) fee-payer key.
        const attackerRecipient = Keypair.generate();

        const ixArgs = {
            amount: new anchor.BN(LAMPORTS_PER_SOL),
        };
        const data = coder.instruction.encode('transfer_sol_with_program', ixArgs);
        const ix = new TransactionInstruction({
            keys: [
                { pubkey: victimAccount.publicKey, isSigner: false, isWritable: true },
                { pubkey: attackerRecipient.publicKey, isSigner: false, isWritable: true },
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            ],
            programId,
            data,
        });

        const tx = new Transaction().add(ix);
        tx.feePayer = payer.publicKey;
        tx.recentBlockhash = svm.latestBlockhash();
        tx.sign(payer);

        const result = svm.sendTransaction(tx);
        assert(result instanceof FailedTransactionMetadata, 'expected the attacker transaction to fail');
        assert.include(
            result.err().toString(),
            'code: 3010',
            `expected Anchor's AccountNotSigner error (code 3010: "The given account did not sign"), got: ${result.toString()}`,
        );
    });
});
