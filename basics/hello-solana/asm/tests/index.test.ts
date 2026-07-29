import { Keypair, LAMPORTS_PER_SOL, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import { assert } from 'chai';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';

describe('hello-solana', () => {
    const PROGRAM_ID = PublicKey.unique();

    // load program in litesvm
    const svm = new LiteSVM();
    svm.addProgramFromFile(PROGRAM_ID, 'tests/fixtures/hello-solana-asm-program.so');

    const payer = Keypair.generate();
    svm.airdrop(payer.publicKey, BigInt(LAMPORTS_PER_SOL));

    it('Say hello!', () => {
        // We set up our instruction first.
        const ix = new TransactionInstruction({
            keys: [{ pubkey: payer.publicKey, isSigner: true, isWritable: true }],
            programId: PROGRAM_ID,
            data: Buffer.from([]), // No data
        });

        const tx = new Transaction();
        tx.recentBlockhash = svm.latestBlockhash();
        tx.add(ix).sign(payer);

        // Now we process the transaction
        const result = svm.sendTransaction(tx);
        assert(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);

        const logs = result.logs();
        assert(logs[0].startsWith(`Program ${PROGRAM_ID}`));
        assert(logs[1] === 'Program log: Hello, Solana!');
    });
});
