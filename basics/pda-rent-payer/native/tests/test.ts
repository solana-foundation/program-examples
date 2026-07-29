import { Buffer } from 'node:buffer';
import {
    AccountRole,
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
import { SYSTEM_PROGRAM_ADDRESS } from '@solana-program/system';
import * as borsh from 'borsh';
import { assert } from 'chai';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';

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

    const MyInstruction = {
        InitRentVault: 0,
        CreateNewAccount: 1,
    } as const;

    const InitRentVaultSchema = {
        struct: {
            instruction: 'u8',
            fund_lamports: 'u64',
        },
    };

    const CreateNewAccountSchema = {
        struct: {
            instruction: 'u8',
        },
    };

    function borshSerialize(schema: borsh.Schema, data: object): Buffer {
        return Buffer.from(borsh.serialize(schema, data));
    }

    async function deriveRentVaultPda() {
        const pda = await getProgramDerivedAddress({
            programAddress: programId,
            seeds: ['rent_vault'],
        });
        console.log(`PDA: ${pda[0]}`);
        return pda;
    }

    it('Initialize the Rent Vault', async () => {
        const [rentVaultPda, _] = await deriveRentVaultPda();
        const ix = {
            programAddress: programId,
            accounts: [
                { address: rentVaultPda, role: AccountRole.WRITABLE },
                { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ],
            data: new Uint8Array(
                borshSerialize(InitRentVaultSchema, {
                    instruction: MyInstruction.InitRentVault,
                    fund_lamports: 1000000000,
                }),
            ),
        };

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
        const [rentVaultPda, _] = await deriveRentVaultPda();
        const ix = {
            programAddress: programId,
            accounts: [
                { address: newAccount.address, role: AccountRole.WRITABLE_SIGNER, signer: newAccount },
                { address: rentVaultPda, role: AccountRole.WRITABLE },
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ],
            data: new Uint8Array(
                borshSerialize(CreateNewAccountSchema, {
                    instruction: MyInstruction.CreateNewAccount,
                }),
            ),
        };

        const transactionMessage = pipe(
            createTransactionMessage({ version: 0 }),
            m => setTransactionMessageFeePayerSigner(payer, m),
            m => svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
            m => appendTransactionMessageInstruction(ix, m),
        );
        const signedTx = await signTransactionMessageWithSigners(transactionMessage);

        // Now we process the transaction
        const result = svm.sendTransaction(signedTx);
        assert(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);
    });
});
