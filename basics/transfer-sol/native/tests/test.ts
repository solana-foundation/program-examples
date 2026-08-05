import {
    type Address,
    AccountRole,
    appendTransactionMessageInstructions,
    createTransactionMessage,
    generateKeyPairSigner,
    type Instruction,
    type KeyPairSigner,
    lamports,
    pipe,
    setTransactionMessageFeePayerSigner,
    signTransactionMessageWithSigners,
} from '@solana/kit';
import { getCreateAccountInstruction } from '@solana-program/system';
import { assert } from 'chai';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';
import { createTransferInstruction, InstructionType } from './instruction';

const LAMPORTS_PER_SOL = 1_000_000_000;

describe('transfer-sol', () => {
    const svm = new LiteSVM();
    let programId: Address;
    let payer: KeyPairSigner;
    let test1Recipient: KeyPairSigner;
    let test2Recipient1: KeyPairSigner;
    let test2Recipient2: KeyPairSigner;

    const transferAmount = 1 * LAMPORTS_PER_SOL;

    before(async () => {
        programId = (await generateKeyPairSigner()).address;
        svm.addProgramFromFile(programId, 'tests/fixtures/transfer_sol_program.so');
        payer = await generateKeyPairSigner();
        svm.airdrop(payer.address, lamports(BigInt(10 * LAMPORTS_PER_SOL)));
        test1Recipient = await generateKeyPairSigner();
        test2Recipient1 = await generateKeyPairSigner();
        test2Recipient2 = await generateKeyPairSigner();
    });

    async function sendTransaction(instructions: Instruction[]) {
        const transactionMessage = pipe(
            createTransactionMessage({ version: 0 }),
            m => setTransactionMessageFeePayerSigner(payer, m),
            m => svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
            m => appendTransactionMessageInstructions(instructions, m),
        );
        const signedTx = await signTransactionMessageWithSigners(transactionMessage);
        const result = svm.sendTransaction(signedTx);
        assert(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);
    }

    it('Transfer between accounts using the system program', async () => {
        getBalances(payer.address, test1Recipient.address, 'Beginning');

        const ix = createTransferInstruction(
            payer,
            test1Recipient.address,
            programId,
            InstructionType.CpiTransfer,
            transferAmount,
        );

        await sendTransaction([ix]);

        getBalances(payer.address, test1Recipient.address, 'Resulting');
    });

    it('Create two accounts for the following test', async () => {
        const ix = (newAccount: KeyPairSigner) => {
            return getCreateAccountInstruction({
                payer,
                newAccount,
                space: 0,
                lamports: 2 * LAMPORTS_PER_SOL,
                programAddress: programId,
            });
        };

        await sendTransaction([ix(test2Recipient1), ix(test2Recipient2)]);
    });

    it('Transfer between accounts using our program', async () => {
        getBalances(test2Recipient1.address, test2Recipient2.address, 'Beginning');

        const ix = createTransferInstruction(
            test2Recipient1,
            test2Recipient2.address,
            programId,
            InstructionType.ProgramTransfer,
            transferAmount,
        );

        await sendTransaction([ix]);

        getBalances(test2Recipient1.address, test2Recipient2.address, 'Resulting');
    });

    it("An attacker cannot drain another user's program-owned account", async () => {
        const victimAccount = await generateKeyPairSigner();
        const attackerRecipient = await generateKeyPairSigner();

        const createIx = getCreateAccountInstruction({
            payer,
            newAccount: victimAccount,
            space: 0,
            lamports: 2 * LAMPORTS_PER_SOL,
            programAddress: programId,
        });
        await sendTransaction([createIx]);

        // The attacker never has victimAccount's private key. They build the
        // instruction with victimAccount marked as a non-signer and only
        // sign with their own (unrelated) fee-payer key.
        const legitIx = createTransferInstruction(
            victimAccount,
            attackerRecipient.address,
            programId,
            InstructionType.ProgramTransfer,
            transferAmount,
        );
        const attackIx = {
            ...legitIx,
            accounts: [{ address: victimAccount.address, role: AccountRole.WRITABLE }, ...legitIx.accounts.slice(1)],
        };

        const transactionMessage = pipe(
            createTransactionMessage({ version: 0 }),
            m => setTransactionMessageFeePayerSigner(payer, m),
            m => svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
            m => appendTransactionMessageInstructions([attackIx], m),
        );
        const signedTx = await signTransactionMessageWithSigners(transactionMessage);
        const result = svm.sendTransaction(signedTx);
        assert(result instanceof FailedTransactionMetadata, 'expected the attacker transaction to fail');
        assert.include(
            result.err().toString(),
            'MissingRequiredSignature',
            `expected the debit to be rejected for lacking the victim's signature, got: ${result.toString()}`,
        );
    });

    function getBalances(payerAddress: Address, recipientAddress: Address, timeframe: string) {
        const payerBalance = svm.getBalance(payerAddress);
        const recipientBalance = svm.getBalance(recipientAddress);

        console.log(`${timeframe} balances:`);
        console.log(`   Payer: ${payerBalance}`);
        console.log(`   Recipient: ${recipientBalance}`);
    }
});
