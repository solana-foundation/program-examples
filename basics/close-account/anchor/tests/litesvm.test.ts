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
import { LiteSVM } from 'litesvm';
import IDL from '../target/idl/close_account_program.json' with { type: 'json' };

describe('LiteSVM: Close an account', () => {
    const litesvm = new LiteSVM();
    const programId = new PublicKey(IDL.address);
    const payer = Keypair.generate();
    const coder = new anchor.BorshCoder(IDL as anchor.Idl); // For serialization and deserialization

    const programPath = new URL('../target/deploy/close_account_program.so', import.meta.url).pathname;
    litesvm.addProgramFromFile(programId, programPath);

    litesvm.airdrop(payer.publicKey, BigInt(5 * LAMPORTS_PER_SOL));

    /**
     * Derive the PDA for the user's account.
     */
    const [userAccountAddress] = PublicKey.findProgramAddressSync(
        [Buffer.from('USER'), payer.publicKey.toBuffer()],
        programId,
    );

    it('Create an account', () => {
        /**
         * Instruction data
         * Convert into buffer of instruction data
         */
        const dataArg = { name: 'John Doe' };
        const data = coder.instruction.encode('create_user', dataArg);

        /**
         * Create Transactions
         */
        const ix = new TransactionInstruction({
            keys: [
                { pubkey: payer.publicKey, isSigner: true, isWritable: true },
                { pubkey: userAccountAddress, isSigner: false, isWritable: true },
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            ],
            programId,
            data,
        });

        const tx = new Transaction().add(ix);
        tx.feePayer = payer.publicKey;
        tx.recentBlockhash = litesvm.latestBlockhash();
        tx.sign(payer);
        litesvm.sendTransaction(tx);

        /**
         * Fetch account
         */
        const userAccount = litesvm.getAccount(userAccountAddress);
        const user = coder.accounts.decode('UserState', Buffer.from(userAccount.data));
        assert.equal(user.name, 'John Doe');
        assert.equal(user.user.toBase58(), payer.publicKey.toBase58());
    });

    it('Close an account', () => {
        const data = coder.instruction.encode('close_user', {});

        const ix = new TransactionInstruction({
            keys: [
                { pubkey: payer.publicKey, isSigner: true, isWritable: true },
                { pubkey: userAccountAddress, isSigner: false, isWritable: true },
            ],
            programId,
            data,
        });

        const tx = new Transaction().add(ix);
        tx.feePayer = payer.publicKey;
        tx.recentBlockhash = litesvm.latestBlockhash();
        tx.sign(payer);
        litesvm.sendTransaction(tx);

        /**
         * Fetch account
         */
        const userAccount = litesvm.getAccount(userAccountAddress);
        assert.equal(userAccount, null);
    });
});
