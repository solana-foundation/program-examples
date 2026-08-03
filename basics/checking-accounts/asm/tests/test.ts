import assert from 'node:assert';
import {
    AccountRole,
    type Address,
    appendTransactionMessageInstructions,
    createTransactionMessage,
    generateKeyPairSigner,
    type Instruction,
    type KeyPairSigner,
    lamports,
    pipe,
    setTransactionMessageFeePayerSigner,
    signTransactionMessageWithSigners,
    type TransactionSigner,
} from '@solana/kit';
import { getCreateAccountInstruction, getTransferSolInstruction, SYSTEM_PROGRAM_ADDRESS } from '@solana-program/system';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';

const LAMPORTS_PER_SOL = 1_000_000_000n;

describe('Checking accounts', () => {
    const svm = new LiteSVM();
    let programId: Address;
    let payer: KeyPairSigner;
    let rentExemptBalance: bigint;

    // We'll create this ahead of time.
    // Our program will try to modify it.
    let accountToChange: KeyPairSigner;
    // Our program will create this.
    let accountToCreate: KeyPairSigner;

    before(async () => {
        programId = (await generateKeyPairSigner()).address;
        svm.addProgramFromFile(programId, 'tests/fixtures/checking-account-asm-program.so');
        payer = await generateKeyPairSigner();
        svm.airdrop(payer.address, lamports(LAMPORTS_PER_SOL));
        rentExemptBalance = svm.minimumBalanceForRentExemption(0n);
        accountToChange = await generateKeyPairSigner();
        accountToCreate = await generateKeyPairSigner();
    });

    async function signTransaction(instructions: Instruction[], feePayer: TransactionSigner) {
        const transactionMessage = pipe(
            createTransactionMessage({ version: 0 }),
            m => setTransactionMessageFeePayerSigner(feePayer, m),
            m => svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
            m => appendTransactionMessageInstructions(instructions, m),
        );
        return await signTransactionMessageWithSigners(transactionMessage);
    }

    async function sendExpectSuccess(instructions: Instruction[], feePayer: TransactionSigner = payer) {
        const result = svm.sendTransaction(await signTransaction(instructions, feePayer));
        assert.ok(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);
    }

    async function sendExpectCustomError(
        instructions: Instruction[],
        code: number,
        feePayer: TransactionSigner = payer,
    ) {
        const result = svm.sendTransaction(await signTransaction(instructions, feePayer));
        assert.ok(result instanceof FailedTransactionMetadata, 'expected transaction to fail');
        assert.equal(
            result.err().toString(),
            `TransactionErrorInstructionError { index: 0, error: InstructionErrorCustom { code: ${code} } }`,
        );
    }

    it('Create an account owned by our program', async () => {
        const ix = getCreateAccountInstruction({
            payer,
            newAccount: accountToChange,
            lamports: rentExemptBalance,
            space: 0,
            programAddress: programId, // Our program
        });

        await sendExpectSuccess([ix]);
    });

    it('Check accounts', async () => {
        const ix = {
            programAddress: programId,
            accounts: [
                { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
                { address: accountToCreate.address, role: AccountRole.WRITABLE_SIGNER, signer: accountToCreate },
                { address: accountToChange.address, role: AccountRole.WRITABLE_SIGNER, signer: accountToChange },
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ],
            data: new Uint8Array(0),
        };

        await sendExpectSuccess([ix]);
    });

    it('Invalid number of accounts (error 1)', async () => {
        const ix = {
            programAddress: programId,
            accounts: [{ address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer }],
            data: new Uint8Array(0),
        };

        await sendExpectCustomError([ix], 1);
    });

    it('Payer not signer (error 2)', async () => {
        const feePayer = await generateKeyPairSigner();
        const fakePayer = await generateKeyPairSigner();
        const acCreate = await generateKeyPairSigner();
        const acChange = await generateKeyPairSigner();

        const fund = getTransferSolInstruction({
            source: payer,
            destination: feePayer.address,
            amount: 10_000_000,
        });
        await sendExpectSuccess([fund]);

        const ix = {
            programAddress: programId,
            accounts: [
                { address: fakePayer.address, role: AccountRole.WRITABLE }, // not a signer
                { address: acCreate.address, role: AccountRole.WRITABLE_SIGNER, signer: acCreate },
                { address: acChange.address, role: AccountRole.WRITABLE_SIGNER, signer: acChange },
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ],
            data: new Uint8Array(0),
        };

        await sendExpectCustomError([ix], 2, feePayer);
    });

    it('Account to create already initialized (error 3)', async () => {
        const acCreate = await generateKeyPairSigner();
        const acChange = await generateKeyPairSigner();

        // Fund acCreate so it appears initialized
        const fund = getTransferSolInstruction({
            source: payer,
            destination: acCreate.address,
            amount: 1_000_000,
        });
        // Fund acChange so it is initialized and owned by our program
        const fundChange = getCreateAccountInstruction({
            payer,
            newAccount: acChange,
            lamports: rentExemptBalance,
            space: 0,
            programAddress: programId,
        });

        await sendExpectSuccess([fund, fundChange]);

        const ix = {
            programAddress: programId,
            accounts: [
                { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
                { address: acCreate.address, role: AccountRole.WRITABLE_SIGNER, signer: acCreate },
                { address: acChange.address, role: AccountRole.WRITABLE_SIGNER, signer: acChange },
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ],
            data: new Uint8Array(0),
        };

        await sendExpectCustomError([ix], 3);
    });

    it('Account to change not initialized (error 4)', async () => {
        const acCreate = await generateKeyPairSigner();
        const acChange = await generateKeyPairSigner(); // no lamports

        const ix = {
            programAddress: programId,
            accounts: [
                { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
                { address: acCreate.address, role: AccountRole.WRITABLE_SIGNER, signer: acCreate },
                { address: acChange.address, role: AccountRole.WRITABLE_SIGNER, signer: acChange },
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ],
            data: new Uint8Array(0),
        };

        await sendExpectCustomError([ix], 4);
    });

    it('Invalid system program (error 5)', async () => {
        const acCreate = await generateKeyPairSigner();
        const acChange = await generateKeyPairSigner();
        const fakeSystemProgram = (await generateKeyPairSigner()).address;

        const fund = getCreateAccountInstruction({
            payer,
            newAccount: acChange,
            lamports: rentExemptBalance,
            space: 0,
            programAddress: programId,
        });
        await sendExpectSuccess([fund]);

        const ix = {
            programAddress: programId,
            accounts: [
                { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
                { address: acCreate.address, role: AccountRole.WRITABLE_SIGNER, signer: acCreate },
                { address: acChange.address, role: AccountRole.WRITABLE_SIGNER, signer: acChange },
                { address: fakeSystemProgram, role: AccountRole.READONLY },
            ],
            data: new Uint8Array(0),
        };

        await sendExpectCustomError([ix], 5);
    });

    it('Account to change wrong owner (error 6)', async () => {
        const acCreate = await generateKeyPairSigner();
        const acChange = await generateKeyPairSigner();

        // Fund acChange but keep it owned by the system program (no createAccount with programId)
        const fund = getTransferSolInstruction({
            source: payer,
            destination: acChange.address,
            amount: 1_000_000,
        });
        await sendExpectSuccess([fund]);

        const ix = {
            programAddress: programId,
            accounts: [
                { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
                { address: acCreate.address, role: AccountRole.WRITABLE_SIGNER, signer: acCreate },
                { address: acChange.address, role: AccountRole.WRITABLE_SIGNER, signer: acChange },
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ],
            data: new Uint8Array(0),
        };

        await sendExpectCustomError([ix], 6);
    });
});
