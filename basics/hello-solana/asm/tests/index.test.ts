import { PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import { assert } from 'chai';
import { type ProgramTestContext, start } from 'solana-bankrun';

describe('hello-solana', () => {
    const PROGRAM_ID = PublicKey.unique();

    // load program in solana-bankrun
    let context: ProgramTestContext;
    before(async () => {
        context = await start([{ name: 'hello-solana-asm-program', programId: PROGRAM_ID }], []);
    });

    it('Say hello!', async () => {
        const client = context.banksClient;
        const payer = context.payer;
        const blockhash = context.lastBlockhash;
        // We set up our instruction first.
        const ix = new TransactionInstruction({
            keys: [{ pubkey: payer.publicKey, isSigner: true, isWritable: true }],
            programId: PROGRAM_ID,
            data: Buffer.from([]), // No data
        });

        const tx = new Transaction();
        tx.recentBlockhash = blockhash;
        tx.add(ix).sign(payer);

        // Now we process the transaction
        const transaction = await client.processTransaction(tx);

        assert(transaction.logMessages[0].startsWith(`Program ${PROGRAM_ID}`));
        assert(transaction.logMessages[1] === 'Program log: Hello, Solana!');
    });
});
