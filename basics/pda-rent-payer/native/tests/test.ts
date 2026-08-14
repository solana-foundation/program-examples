import {
    type Address,
    appendTransactionMessageInstruction,
    createTransactionMessage,
    generateKeyPairSigner,
    getProgramDerivedAddress,
    type KeyPairSigner,
    lamports,
    pipe,
    setTransactionMessageFeePayerSigner,
    signTransactionMessageWithSigners,
} from '@solana/kit';
import { assert } from 'chai';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';
import { createCreateNewAccountInstruction, createInitRentVaultInstruction } from '../ts';

describe('PDA Rent-Payer', () => {
    const svm = new LiteSVM();
    let programId: Address;
    let payer: KeyPairSigner;

    before(async () => {
        programId = (await generateKeyPairSigner()).address;
        svm.addProgramFromFile(programId, 'tests/fixtures/pda_rent_payer_program.so');
        payer = await generateKeyPairSigner();
        svm.airdrop(payer.address, lamports(2_000_000_000n));
    });

    async function deriveRentVaultPda() {
        const [pda] = await getProgramDerivedAddress({
            programAddress: programId,
            seeds: ['rent_vault'],
        });
        return pda;
    }

    it('Initialize the Rent Vault', async () => {
        const rentVaultPda = await deriveRentVaultPda();
        const ix = createInitRentVaultInstruction(rentVaultPda, payer, programId, 1_000_000_000n);

        const transactionMessage = pipe(
            createTransactionMessage({ version: 0 }),
            m => setTransactionMessageFeePayerSigner(payer, m),
            m => svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
            m => appendTransactionMessageInstruction(ix, m),
        );
        const signedTx = await signTransactionMessageWithSigners(transactionMessage);

        const result = svm.sendTransaction(signedTx);
        assert(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);
    });

    it('Create a new account using the Rent Vault', async () => {
        const newAccount = await generateKeyPairSigner();
        const rentVaultPda = await deriveRentVaultPda();
        const ix = createCreateNewAccountInstruction(newAccount, rentVaultPda, programId);

        const transactionMessage = pipe(
            createTransactionMessage({ version: 0 }),
            m => setTransactionMessageFeePayerSigner(payer, m),
            m => svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
            m => appendTransactionMessageInstruction(ix, m),
        );
        const signedTx = await signTransactionMessageWithSigners(transactionMessage);

        const result = svm.sendTransaction(signedTx);
        assert(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);
    });
});
