import {
    AccountRole,
    type Address,
    appendTransactionMessageInstruction,
    createTransactionMessage,
    generateKeyPairSigner,
    getProgramDerivedAddress,
    getStructEncoder,
    getU8Encoder,
    getU64Encoder,
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

const INIT_RENT_VAULT_DISCRIMINATOR = 0;
const CREATE_NEW_ACCOUNT_DISCRIMINATOR = 1;
const FUND_LAMPORTS = 1_000_000_000n;

const initRentVaultEncoder = getStructEncoder([
    ['discriminator', getU8Encoder()],
    ['bump', getU8Encoder()],
    ['lamports', getU64Encoder()],
]);

describe('PDA Rent-Payer', () => {
    const svm = new LiteSVM();
    let programId: Address;
    let payer: KeyPairSigner;
    let rentVaultPda: Address;
    let bump: number;
    let rentExemptBalance: bigint;

    before(async () => {
        programId = (await generateKeyPairSigner()).address;
        svm.addProgramFromFile(programId, 'tests/fixtures/pda_rent_payer_pinocchio_program.so');

        payer = await generateKeyPairSigner();
        svm.airdrop(payer.address, lamports(10_000_000_000n));

        [rentVaultPda, bump] = await getProgramDerivedAddress({
            programAddress: programId,
            seeds: ['rent_vault'],
        });
        rentExemptBalance = svm.getRent().minimumBalance(0n);
    });

    function balance(address: Address): bigint {
        const value = svm.getBalance(address);
        assert(value !== null, `expected ${address} to exist`);
        return value;
    }

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

    it('Initialize the Rent Vault', async () => {
        const ix = {
            programAddress: programId,
            accounts: [
                { address: rentVaultPda, role: AccountRole.WRITABLE },
                { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ],
            data: initRentVaultEncoder.encode({
                discriminator: INIT_RENT_VAULT_DISCRIMINATOR,
                bump,
                lamports: FUND_LAMPORTS,
            }),
        };

        const result = await sendInstruction(ix);
        assert(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);

        assert.equal(balance(rentVaultPda), rentExemptBalance + FUND_LAMPORTS);
    });

    it('Create a new account using the Rent Vault', async () => {
        const newAccount = await generateKeyPairSigner();
        const vaultBalanceBefore = balance(rentVaultPda);

        const ix = {
            programAddress: programId,
            accounts: [
                { address: newAccount.address, role: AccountRole.WRITABLE_SIGNER, signer: newAccount },
                { address: rentVaultPda, role: AccountRole.WRITABLE },
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ],
            data: new Uint8Array([CREATE_NEW_ACCOUNT_DISCRIMINATOR, bump]),
        };

        const result = await sendInstruction(ix);
        assert(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);

        assert.equal(balance(newAccount.address), rentExemptBalance);
        assert.equal(balance(rentVaultPda), vaultBalanceBefore - rentExemptBalance);
    });
});
