import {
    type AccountMeta,
    AccountRole,
    type AccountSignerMeta,
    type Address,
    appendTransactionMessageInstruction,
    createTransactionMessage,
    generateKeyPairSigner,
    type Instruction,
    type KeyPairSigner,
    lamports,
    pipe,
    setTransactionMessageFeePayerSigner,
    signTransactionMessageWithSigners,
} from '@solana/kit';
import { getCreateAccountInstruction, SYSTEM_PROGRAM_ADDRESS } from '@solana-program/system';
import { assert } from 'chai';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';

const CPI_TRANSFER_DISCRIMINATOR = 0;
const PROGRAM_TRANSFER_DISCRIMINATOR = 1;

describe('transfer-sol', () => {
    const svm = new LiteSVM();
    let programId: Address;
    let payer: KeyPairSigner;

    const transferAmount = 1_000_000_000n;

    before(async () => {
        programId = (await generateKeyPairSigner()).address;
        svm.addProgramFromFile(programId, 'tests/fixtures/transfer_sol_pinocchio_program.so');

        payer = await generateKeyPairSigner();
        svm.airdrop(payer.address, lamports(10_000_000_000n));
    });

    function createTransferInstruction(from: KeyPairSigner, to: Address, discriminator: number): Instruction {
        const data = Buffer.alloc(9);
        data.writeUInt8(discriminator, 0);
        data.writeBigUInt64LE(transferAmount, 1);

        const accounts: (AccountMeta | AccountSignerMeta)[] = [
            { address: from.address, role: AccountRole.WRITABLE_SIGNER, signer: from },
            { address: to, role: AccountRole.WRITABLE },
        ];
        if (discriminator === CPI_TRANSFER_DISCRIMINATOR) {
            accounts.push({ address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY });
        }

        return { programAddress: programId, accounts, data: new Uint8Array(data) };
    }

    async function sendInstruction(ix: Instruction) {
        const transactionMessage = pipe(
            createTransactionMessage({ version: 0 }),
            m => setTransactionMessageFeePayerSigner(payer, m),
            m => svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
            m => appendTransactionMessageInstruction(ix, m),
        );
        const signedTx = await signTransactionMessageWithSigners(transactionMessage);
        const result = svm.sendTransaction(signedTx);
        assert(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);
    }

    it('Transfer between accounts using a system program CPI', async () => {
        const recipient = (await generateKeyPairSigner()).address;
        const payerBalanceBefore = svm.getBalance(payer.address);

        const ix = createTransferInstruction(payer, recipient, CPI_TRANSFER_DISCRIMINATOR);

        await sendInstruction(ix);

        assert.equal(svm.getBalance(recipient), transferAmount);
        assert(payerBalanceBefore !== null && svm.getBalance(payer.address)! < payerBalanceBefore);
    });

    it('Transfer between accounts using our program', async () => {
        const programOwnedAccount = await generateKeyPairSigner();
        const recipient = (await generateKeyPairSigner()).address;

        const createIx = getCreateAccountInstruction({
            payer,
            newAccount: programOwnedAccount,
            lamports: 2_000_000_000n,
            space: 0,
            programAddress: programId,
        });

        await sendInstruction(createIx);

        const ix = createTransferInstruction(programOwnedAccount, recipient, PROGRAM_TRANSFER_DISCRIMINATOR);

        await sendInstruction(ix);

        assert.equal(svm.getBalance(recipient), transferAmount);
        assert.equal(svm.getBalance(programOwnedAccount.address), 2_000_000_000n - transferAmount);
    });
});
