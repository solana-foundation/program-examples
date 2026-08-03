import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Keypair, LAMPORTS_PER_SOL, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import { assert } from 'chai';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';

const PROGRAM_ID = new PublicKey('GUkjQmrLPFXXNK1bFLKt8XQi6g3TjxcHVspbjDoHvMG2');

describe('pyth', () => {
    const svm = new LiteSVM();
    svm.addProgramFromFile(PROGRAM_ID, 'target/deploy/pythexample.so');

    const payer = Keypair.generate();
    svm.airdrop(payer.publicKey, BigInt(LAMPORTS_PER_SOL));

    // A real SOL/USD PriceUpdateV2 account dumped from mainnet by prepare.mjs
    const fixture = JSON.parse(readFileSync('tests/fixtures/sol_usd_price_update.json', 'utf8'));
    const priceUpdate = new PublicKey(fixture.pubkey);
    svm.setAccount(priceUpdate, {
        lamports: fixture.account.lamports,
        data: Buffer.from(fixture.account.data[0], 'base64'),
        owner: new PublicKey(fixture.account.owner),
        executable: false,
    });

    it('Reads the SOL/USD price feed', () => {
        const discriminator = createHash('sha256').update('global:read_price').digest().subarray(0, 8);

        const ix = new TransactionInstruction({
            keys: [{ pubkey: priceUpdate, isSigner: false, isWritable: false }],
            programId: PROGRAM_ID,
            data: discriminator,
        });

        const tx = new Transaction();
        tx.recentBlockhash = svm.latestBlockhash();
        tx.add(ix).sign(payer);

        const result = svm.sendTransaction(tx);
        assert(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);

        const logs = result.logs();
        assert(logs.some(log => log.includes('Price:')));
        assert(logs.some(log => log.includes('Exponent:')));
    });

    it('Rejects an account not owned by the Pyth receiver', () => {
        const discriminator = createHash('sha256').update('global:read_price').digest().subarray(0, 8);

        const ix = new TransactionInstruction({
            keys: [{ pubkey: payer.publicKey, isSigner: false, isWritable: false }],
            programId: PROGRAM_ID,
            data: discriminator,
        });

        const tx = new Transaction();
        tx.recentBlockhash = svm.latestBlockhash();
        tx.add(ix).sign(payer);

        const result = svm.sendTransaction(tx);
        assert(result instanceof FailedTransactionMetadata);
    });
});
