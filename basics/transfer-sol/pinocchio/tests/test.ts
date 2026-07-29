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

const CPI_TRANSFER_DISCRIMINATOR = 0;
const PROGRAM_TRANSFER_DISCRIMINATOR = 1;

describe('transfer-sol', () => {
    const PROGRAM_ID = PublicKey.unique();
    const svm = new LiteSVM();
    svm.addProgramFromFile(PROGRAM_ID, 'tests/fixtures/transfer_sol_pinocchio_program.so');

    const payer = Keypair.generate();
    svm.airdrop(payer.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

    const transferAmount = BigInt(LAMPORTS_PER_SOL);

    function createTransferInstruction(from: PublicKey, to: PublicKey, discriminator: number): TransactionInstruction {
        const data = Buffer.alloc(9);
        data.writeUInt8(discriminator, 0);
        data.writeBigUInt64LE(transferAmount, 1);

        const keys = [
            { pubkey: from, isSigner: true, isWritable: true },
            { pubkey: to, isSigner: false, isWritable: true },
        ];
        if (discriminator === CPI_TRANSFER_DISCRIMINATOR) {
            keys.push({ pubkey: SystemProgram.programId, isSigner: false, isWritable: false });
        }

        return new TransactionInstruction({ keys, programId: PROGRAM_ID, data });
    }

    function sendTransaction(tx: Transaction) {
        const result = svm.sendTransaction(tx);
        assert(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);
    }

    it('Transfer between accounts using a system program CPI', () => {
        const recipient = Keypair.generate().publicKey;
        const payerBalanceBefore = svm.getBalance(payer.publicKey);

        const ix = createTransferInstruction(payer.publicKey, recipient, CPI_TRANSFER_DISCRIMINATOR);

        const tx = new Transaction();
        tx.recentBlockhash = svm.latestBlockhash();
        tx.add(ix).sign(payer);

        sendTransaction(tx);

        assert.equal(svm.getBalance(recipient), transferAmount);
        assert(payerBalanceBefore !== null && svm.getBalance(payer.publicKey)! < payerBalanceBefore);
    });

    it('Transfer between accounts using our program', () => {
        const programOwnedAccount = Keypair.generate();
        const recipient = Keypair.generate().publicKey;

        const createIx = SystemProgram.createAccount({
            fromPubkey: payer.publicKey,
            newAccountPubkey: programOwnedAccount.publicKey,
            lamports: 2 * LAMPORTS_PER_SOL,
            space: 0,
            programId: PROGRAM_ID,
        });

        const createTx = new Transaction();
        createTx.recentBlockhash = svm.latestBlockhash();
        createTx.add(createIx).sign(payer, programOwnedAccount);

        sendTransaction(createTx);

        const ix = createTransferInstruction(programOwnedAccount.publicKey, recipient, PROGRAM_TRANSFER_DISCRIMINATOR);

        const tx = new Transaction();
        tx.recentBlockhash = svm.latestBlockhash();
        tx.add(ix).sign(payer, programOwnedAccount);

        sendTransaction(tx);

        assert.equal(svm.getBalance(recipient), transferAmount);
        assert.equal(svm.getBalance(programOwnedAccount.publicKey), BigInt(2 * LAMPORTS_PER_SOL) - transferAmount);
    });
});
