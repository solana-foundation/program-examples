import {
    type AccountMeta,
    AccountRole,
    type AccountSignerMeta,
    type Address,
    appendTransactionMessageInstruction,
    createTransactionMessage,
    generateKeyPairSigner,
    getAddressEncoder,
    getProgramDerivedAddress,
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

const USER_ACCOUNT_SIZE = 16;
const CREATE_DISCRIMINATOR = 0;
const CLOSE_DISCRIMINATOR = 1;

describe('Close Account!', () => {
    const svm = new LiteSVM();
    let programId: Address;
    let payer: KeyPairSigner;
    let userAccount: Address;
    let bump: number;
    let keys: (AccountMeta | AccountSignerMeta)[];

    before(async () => {
        programId = (await generateKeyPairSigner()).address;
        svm.addProgramFromFile(programId, 'tests/fixtures/close_account_pinocchio_program.so');

        payer = await generateKeyPairSigner();
        svm.airdrop(payer.address, lamports(10_000_000_000n));

        [userAccount, bump] = await getProgramDerivedAddress({
            programAddress: programId,
            seeds: ['USER', getAddressEncoder().encode(payer.address)],
        });

        keys = [
            { address: userAccount, role: AccountRole.WRITABLE },
            { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
            { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
        ];
    });

    async function sendInstruction(ix: Instruction) {
        const transactionMessage = pipe(
            createTransactionMessage({ version: 0 }),
            m => setTransactionMessageFeePayerSigner(payer, m),
            m => svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
            m => appendTransactionMessageInstruction(ix, m),
        );
        const signedTx = await signTransactionMessageWithSigners(transactionMessage);
        return svm.sendTransaction(signedTx);
    }

    it('Create the account', async () => {
        const name = Buffer.alloc(USER_ACCOUNT_SIZE);
        name.write('Jacob');

        const ix = {
            programAddress: programId,
            accounts: keys,
            data: new Uint8Array(Buffer.concat([Buffer.from([CREATE_DISCRIMINATOR, bump]), name])),
        };

        const result = await sendInstruction(ix);
        assert(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);

        const account = svm.getAccount(userAccount);
        assert(account.exists, 'expected user account to exist');
        assert.equal(account.data.length, USER_ACCOUNT_SIZE);
        assert.equal(account.programAddress, programId, 'expected user account to be owned by the program');
        assert.equal(Buffer.from(account.data.slice(0, 5)).toString(), 'Jacob');
    });

    it('Close the account', async () => {
        const payerBalanceBefore = svm.getBalance(payer.address)!;

        const ix = {
            programAddress: programId,
            accounts: keys,
            data: new Uint8Array([CLOSE_DISCRIMINATOR]),
        };

        const result = await sendInstruction(ix);
        assert(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);

        const account = svm.getAccount(userAccount);
        assert(account.exists, 'expected account to still exist with zeroed data');
        assert.equal(account.data.length, 0);
        assert.equal(
            account.programAddress,
            SYSTEM_PROGRAM_ADDRESS,
            'expected account to be reassigned to the system program',
        );

        const payerBalanceAfter = svm.getBalance(payer.address)!;
        assert(payerBalanceAfter > payerBalanceBefore, 'expected payer to reclaim the rent lamports');
    });
});
