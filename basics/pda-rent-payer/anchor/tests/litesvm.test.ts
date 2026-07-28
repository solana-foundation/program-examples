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
import IDL from '../target/idl/pda_rent_payer.json' with { type: 'json' };

describe('LiteSVM: PDA Rent-Payer', () => {
    const svm = new LiteSVM();
    const programId = new PublicKey(IDL.address);
    const coder = new anchor.BorshCoder(IDL as anchor.Idl);
    const payer = Keypair.generate();
    svm.airdrop(payer.publicKey, BigInt(10000000000));

    const programPath = new URL('../target/deploy/pda_rent_payer.so', import.meta.url).pathname;
    svm.addProgramFromFile(programId, programPath);

    /**
     * generate PDA for the Rent Vault
     */
    const [rentVaultPDA] = PublicKey.findProgramAddressSync([Buffer.from('rent_vault')], programId);

    it('Initialize the Rent Vault', () => {
        const ixArgs = {
            fund_lamports: new anchor.BN(LAMPORTS_PER_SOL),
        };

        const data = coder.instruction.encode('init_rent_vault', ixArgs);
        const ix = new TransactionInstruction({
            keys: [
                { pubkey: payer.publicKey, isSigner: true, isWritable: true },
                { pubkey: rentVaultPDA, isSigner: false, isWritable: true },
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

        /**
         * Fetch the account and check its rent vault account info
         */
        const rentVaultAccountInfo = svm.getAccount(rentVaultPDA);

        assert.equal(rentVaultAccountInfo.lamports, LAMPORTS_PER_SOL);
    });

    it('Create a new account using the Rent Vault', () => {
        const newAccount = new Keypair();

        const data = coder.instruction.encode('create_new_account', {});
        const ix = new TransactionInstruction({
            keys: [
                { pubkey: newAccount.publicKey, isSigner: true, isWritable: true },
                { pubkey: rentVaultPDA, isSigner: false, isWritable: true },
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            ],
            programId,
            data,
        });

        const tx = new Transaction().add(ix);
        tx.feePayer = payer.publicKey;
        tx.recentBlockhash = svm.latestBlockhash();
        tx.sign(payer, newAccount);
        svm.sendTransaction(tx);

        /**
         * Fetch the newAccount and check its rent
         */
        const minLamports = svm.minimumBalanceForRentExemption(BigInt(0));
        const newAccountInfo = svm.getAccount(newAccount.publicKey);

        assert.equal(newAccountInfo.lamports, Number(minLamports));
    });
});
