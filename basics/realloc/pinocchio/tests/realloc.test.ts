import { Buffer } from 'node:buffer';
import {
    AccountRole,
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
import { SYSTEM_PROGRAM_ADDRESS } from '@solana-program/system';
import { assert } from 'chai';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';

describe('Realloc!', () => {
    const svm = new LiteSVM();
    let programId: Address;
    let payer: KeyPairSigner;
    let testAccount: KeyPairSigner;

    before(async () => {
        programId = (await generateKeyPairSigner()).address;
        svm.addProgramFromFile(programId, 'tests/fixtures/realloc_pinocchio_program.so');

        payer = await generateKeyPairSigner();
        svm.airdrop(payer.address, lamports(1_000_000_000n));

        testAccount = await generateKeyPairSigner();
    });

    function fixedString(value: string): Buffer {
        const bytes = Buffer.alloc(8);
        bytes.write(value, 0, 8, 'utf8');
        return bytes;
    }

    function readFixedString(data: Uint8Array, offset: number): string {
        return Buffer.from(data.slice(offset, offset + 8))
            .toString('utf8')
            .replace(/\0+$/, '');
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

    function getTestAccountData(): Uint8Array {
        const account = svm.getAccount(testAccount.address);
        assert(account.exists, 'test account not found');
        return new Uint8Array(account.data);
    }

    it('Create the account with data', async () => {
        const ix = {
            programAddress: programId,
            accounts: [
                { address: testAccount.address, role: AccountRole.WRITABLE_SIGNER, signer: testAccount },
                { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ],
            data: new Uint8Array(
                Buffer.concat([
                    Buffer.from([0]),
                    fixedString('Jacob'),
                    Buffer.from([123]),
                    fixedString('Main St.'),
                    fixedString('Chicago'),
                ]),
            ),
        };

        await sendInstruction(ix);

        const data = getTestAccountData();
        assert.strictEqual(data.length, 25);
        assert.strictEqual(readFixedString(data, 0), 'Jacob');
        assert.strictEqual(data[8], 123);
        assert.strictEqual(readFixedString(data, 9), 'Main St.');
        assert.strictEqual(readFixedString(data, 17), 'Chicago');
    });

    it('Reallocate WITHOUT zero init', async () => {
        const zip = Buffer.alloc(4);
        zip.writeUInt32LE(12345, 0);

        const ix = {
            programAddress: programId,
            accounts: [
                { address: testAccount.address, role: AccountRole.WRITABLE },
                { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ],
            data: new Uint8Array(Buffer.concat([Buffer.from([1]), fixedString('Illinois'), zip])),
        };

        await sendInstruction(ix);

        const data = getTestAccountData();
        assert.strictEqual(data.length, 37);
        assert.strictEqual(readFixedString(data, 0), 'Jacob');
        assert.strictEqual(readFixedString(data, 25), 'Illinois');
        assert.strictEqual(Buffer.from(data).readUInt32LE(33), 12345);
    });

    it('Reallocate WITH zero init', async () => {
        const ix = {
            programAddress: programId,
            accounts: [{ address: testAccount.address, role: AccountRole.WRITABLE }],
            data: new Uint8Array(
                Buffer.concat([
                    Buffer.from([2]),
                    fixedString('Perelyn'),
                    fixedString('Eng'),
                    fixedString('Anza'),
                    Buffer.from([2]),
                ]),
            ),
        };

        await sendInstruction(ix);

        const data = getTestAccountData();
        assert.strictEqual(data.length, 25);
        assert.strictEqual(readFixedString(data, 0), 'Perelyn');
        assert.strictEqual(readFixedString(data, 8), 'Eng');
        assert.strictEqual(readFixedString(data, 16), 'Anza');
        assert.strictEqual(data[24], 2);
    });
});
