import anchor from '@anchor-lang/core';
import { Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import { assert } from 'chai';
import { LiteSVM } from 'litesvm';
import IDL from '../target/idl/program_derived_addresses_program.json' with { type: 'json' };

describe('LiteSVM: PDA', () => {
    const svm = new LiteSVM();
    const programId = new PublicKey(IDL.address);
    const coder = new anchor.BorshCoder(IDL as anchor.Idl);

    const payer = Keypair.generate();
    svm.airdrop(payer.publicKey, BigInt(1000000000));

    const programPath = new URL('../target/deploy/program_derived_addresses_program.so', import.meta.url).pathname;
    svm.addProgramFromFile(programId, programPath);

    // PDA for the page visits account
    const [pageVisitPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from('page_visits'), payer.publicKey.toBuffer()],
        programId,
    );

    it('Create the page visits tracking PDA', () => {
        const data = coder.instruction.encode('create_page_visits', {});
        const ix = new TransactionInstruction({
            keys: [
                { pubkey: payer.publicKey, isSigner: true, isWritable: true },
                { pubkey: pageVisitPDA, isSigner: false, isWritable: true },
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

        //Fetch the pageVisitPDA account and check it page visit count
        const pageVisitPDAAccInfo = svm.getAccount(pageVisitPDA);
        const pageVisitAccount = coder.accounts.decode('PageVisits', Buffer.from(pageVisitPDAAccInfo.data));

        assert.equal(pageVisitAccount.page_visits, 0);
    });

    it('Visit the page!', () => {
        const data = coder.instruction.encode('increment_page_visits', {});
        const ix = new TransactionInstruction({
            keys: [
                { pubkey: payer.publicKey, isSigner: true, isWritable: true },
                { pubkey: pageVisitPDA, isSigner: false, isWritable: true },
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
        svm.expireBlockhash();

        //Fetch the pageVisitPDA account and check it page visit count
        const pageVisitPDAAccInfo = svm.getAccount(pageVisitPDA);
        const pageVisitAccount = coder.accounts.decode('PageVisits', Buffer.from(pageVisitPDAAccInfo.data));

        assert.equal(pageVisitAccount.page_visits, 1);
    });

    it('Again visit the page!', () => {
        const data = coder.instruction.encode('increment_page_visits', {});
        const ix = new TransactionInstruction({
            keys: [
                { pubkey: payer.publicKey, isSigner: true, isWritable: true },
                { pubkey: pageVisitPDA, isSigner: false, isWritable: true },
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

        //Fetch the pageVisitPDA account and check it page visit count
        const pageVisitPDAAccInfo = svm.getAccount(pageVisitPDA);
        const pageVisitAccount = coder.accounts.decode('PageVisits', Buffer.from(pageVisitPDAAccInfo.data));

        assert.equal(pageVisitAccount.page_visits, 2);
    });
});
