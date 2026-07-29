import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { assert } from 'chai';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';
import { createTransferInstruction, InstructionType } from './instruction';

describe('transfer-sol', () => {
    const PROGRAM_ID = PublicKey.unique();
    const svm = new LiteSVM();
    svm.addProgramFromFile(PROGRAM_ID, 'tests/fixtures/transfer_sol_program.so');

    const payer = Keypair.generate();
    svm.airdrop(payer.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

    const transferAmount = 1 * LAMPORTS_PER_SOL;
    const test1Recipient = Keypair.generate();
    const test2Recipient1 = Keypair.generate();
    const test2Recipient2 = Keypair.generate();

    function sendTransaction(tx: Transaction) {
        const result = svm.sendTransaction(tx);
        assert(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);
    }

    it('Transfer between accounts using the system program', () => {
        getBalances(payer.publicKey, test1Recipient.publicKey, 'Beginning');

        const ix = createTransferInstruction(
            payer.publicKey,
            test1Recipient.publicKey,
            PROGRAM_ID,
            InstructionType.CpiTransfer,
            transferAmount,
        );

        const tx = new Transaction();
        tx.recentBlockhash = svm.latestBlockhash();
        tx.add(ix).sign(payer);

        sendTransaction(tx);

        getBalances(payer.publicKey, test1Recipient.publicKey, 'Resulting');
    });

    it('Create two accounts for the following test', () => {
        const ix = (pubkey: PublicKey) => {
            return SystemProgram.createAccount({
                fromPubkey: payer.publicKey,
                newAccountPubkey: pubkey,
                space: 0,
                lamports: 2 * LAMPORTS_PER_SOL,
                programId: PROGRAM_ID,
            });
        };

        const tx = new Transaction();
        tx.recentBlockhash = svm.latestBlockhash();
        tx.add(ix(test2Recipient1.publicKey))
            .add(ix(test2Recipient2.publicKey))
            .sign(payer, test2Recipient1, test2Recipient2);

        sendTransaction(tx);
    });

    it('Transfer between accounts using our program', () => {
        getBalances(test2Recipient1.publicKey, test2Recipient2.publicKey, 'Beginning');

        const ix = createTransferInstruction(
            test2Recipient1.publicKey,
            test2Recipient2.publicKey,
            PROGRAM_ID,
            InstructionType.ProgramTransfer,
            transferAmount,
        );

        const tx = new Transaction();
        tx.recentBlockhash = svm.latestBlockhash();
        tx.add(ix).sign(payer, test2Recipient1);

        sendTransaction(tx);

        getBalances(test2Recipient1.publicKey, test2Recipient2.publicKey, 'Resulting');
    });

    function getBalances(payerPubkey: PublicKey, recipientPubkey: PublicKey, timeframe: string) {
        const payerBalance = svm.getBalance(payerPubkey);
        const recipientBalance = svm.getBalance(recipientPubkey);

        console.log(`${timeframe} balances:`);
        console.log(`   Payer: ${payerBalance}`);
        console.log(`   Recipient: ${recipientBalance}`);
    }
});
