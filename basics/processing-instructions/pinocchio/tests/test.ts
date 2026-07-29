import { Buffer } from 'node:buffer';
import { Keypair, LAMPORTS_PER_SOL, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import { assert } from 'chai';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';

describe('custom-instruction-data', () => {
    const PROGRAM_ID = PublicKey.unique();
    const svm = new LiteSVM();
    svm.addProgramFromFile(PROGRAM_ID, 'tests/fixtures/processing_instructions_pinocchio_program.so');

    const payer = Keypair.generate();
    svm.airdrop(payer.publicKey, BigInt(LAMPORTS_PER_SOL));

    function encodeInstructionData(name: string, height: number): Buffer {
        const data = Buffer.alloc(12);
        data.write(name, 0, 8, 'utf8');
        data.writeUInt32LE(height, 8);
        return data;
    }

    function goToPark(name: string, height: number): string[] {
        const ix = new TransactionInstruction({
            keys: [{ pubkey: payer.publicKey, isSigner: true, isWritable: true }],
            programId: PROGRAM_ID,
            data: encodeInstructionData(name, height),
        });

        const tx = new Transaction();
        tx.recentBlockhash = svm.latestBlockhash();
        tx.add(ix).sign(payer);

        const result = svm.sendTransaction(tx);
        assert(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);
        return result.logs();
    }

    it('Jimmy (height 3) is NOT tall enough to ride', () => {
        const logs = goToPark('Jimmy', 3);
        assert(logs.some(log => log.includes('Welcome to the park, Jimmy')));
        assert(logs.some(log => log.includes('You are NOT tall enough to ride this ride')));
    });

    it('Mary (height 10) is tall enough to ride', () => {
        const logs = goToPark('Mary', 10);
        assert(logs.some(log => log.includes('Welcome to the park, Mary')));
        assert(logs.some(log => log.includes('You are tall enough to ride this ride')));
        assert(!logs.some(log => log.includes('NOT tall enough')));
    });
});
