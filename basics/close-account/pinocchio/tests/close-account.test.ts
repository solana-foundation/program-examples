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

const USER_ACCOUNT_SIZE = 16;
const CREATE_DISCRIMINATOR = 0;
const CLOSE_DISCRIMINATOR = 1;

describe('Close Account!', () => {
    const PROGRAM_ID = PublicKey.unique();
    const svm = new LiteSVM();
    svm.addProgramFromFile(PROGRAM_ID, 'tests/fixtures/close_account_pinocchio_program.so');

    const payer = Keypair.generate();
    svm.airdrop(payer.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

    const [userAccount, bump] = PublicKey.findProgramAddressSync(
        [Buffer.from('USER'), payer.publicKey.toBuffer()],
        PROGRAM_ID,
    );

    const keys = [
        { pubkey: userAccount, isSigner: false, isWritable: true },
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ];

    it('Create the account', () => {
        const name = Buffer.alloc(USER_ACCOUNT_SIZE);
        name.write('Jacob');

        const ix = new TransactionInstruction({
            keys,
            programId: PROGRAM_ID,
            data: Buffer.concat([Buffer.from([CREATE_DISCRIMINATOR, bump]), name]),
        });

        const tx = new Transaction();
        tx.recentBlockhash = svm.latestBlockhash();
        tx.add(ix).sign(payer);

        const result = svm.sendTransaction(tx);
        assert(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);

        const account = svm.getAccount(userAccount);
        assert(account, 'expected user account to exist');
        assert.equal(account.data.length, USER_ACCOUNT_SIZE);
        assert(new PublicKey(account.owner).equals(PROGRAM_ID), 'expected user account to be owned by the program');
        assert.equal(Buffer.from(account.data.slice(0, 5)).toString(), 'Jacob');
    });

    it('Close the account', () => {
        const payerBalanceBefore = svm.getAccount(payer.publicKey)!.lamports;

        const ix = new TransactionInstruction({
            keys,
            programId: PROGRAM_ID,
            data: Buffer.from([CLOSE_DISCRIMINATOR]),
        });

        const tx = new Transaction();
        tx.recentBlockhash = svm.latestBlockhash();
        tx.add(ix).sign(payer);

        const result = svm.sendTransaction(tx);
        assert(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);

        const account = svm.getAccount(userAccount);
        assert(account, 'expected account to still exist with zeroed data');
        assert.equal(account.data.length, 0);
        assert(
            new PublicKey(account.owner).equals(SystemProgram.programId),
            'expected account to be reassigned to the system program',
        );

        const payerBalanceAfter = svm.getAccount(payer.publicKey)!.lamports;
        assert(payerBalanceAfter > payerBalanceBefore, 'expected payer to reclaim the rent lamports');
    });
});
