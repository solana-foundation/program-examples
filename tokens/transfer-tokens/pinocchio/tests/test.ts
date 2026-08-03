import * as path from 'node:path';
import {
    AccountRole,
    type Address,
    appendTransactionMessageInstruction,
    createTransactionMessage,
    generateKeyPairSigner,
    getU64Encoder,
    type Instruction,
    type KeyPairSigner,
    lamports,
    pipe,
    setTransactionMessageFeePayerSigner,
    signTransactionMessageWithSigners,
} from '@solana/kit';
import { SYSTEM_PROGRAM_ADDRESS } from '@solana-program/system';
import {
    ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
    findAssociatedTokenPda,
    getTokenDecoder,
    TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token';
import { assert } from 'chai';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';

// Instruction discriminators (must match the program's processor).
const CREATE_TOKEN = 0;
const MINT_TOKENS = 1;
const TRANSFER_TOKENS = 2;

const u64 = getU64Encoder();

const PROGRAM_SO = path.join(process.cwd(), 'tests', 'fixtures', 'transfer_tokens_pinocchio_program.so');

describe('Transfer Tokens (Pinocchio)', () => {
    let svm: LiteSVM;
    let programId: Address;
    let payer: KeyPairSigner;
    let mint: KeyPairSigner;
    let recipient: KeyPairSigner;
    let payerAta: Address;
    let recipientAta: Address;

    before(async () => {
        svm = new LiteSVM();
        programId = (await generateKeyPairSigner()).address;
        svm.addProgramFromFile(programId, PROGRAM_SO);

        payer = await generateKeyPairSigner();
        svm.airdrop(payer.address, lamports(1_000_000_000n));

        mint = await generateKeyPairSigner();
        recipient = await generateKeyPairSigner();

        [payerAta] = await findAssociatedTokenPda({
            mint: mint.address,
            owner: payer.address,
            tokenProgram: TOKEN_PROGRAM_ADDRESS,
        });
        [recipientAta] = await findAssociatedTokenPda({
            mint: mint.address,
            owner: recipient.address,
            tokenProgram: TOKEN_PROGRAM_ADDRESS,
        });
    });

    async function sendInstruction(ix: Instruction) {
        const transactionMessage = pipe(
            createTransactionMessage({ version: 0 }),
            m => setTransactionMessageFeePayerSigner(payer, m),
            m => svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
            m => appendTransactionMessageInstruction(ix, m),
        );
        const signedTx = await signTransactionMessageWithSigners(transactionMessage);
        const result = svm.sendTransaction(signedTx);
        if (result instanceof FailedTransactionMetadata) {
            throw new Error(`transaction failed: ${result.toString()}`);
        }
    }

    it('Creates an SPL token mint', async () => {
        const ix = {
            programAddress: programId,
            accounts: [
                { address: mint.address, role: AccountRole.WRITABLE_SIGNER, signer: mint }, // mint account
                { address: payer.address, role: AccountRole.READONLY }, // mint authority
                { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer }, // payer
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY }, // system program
                { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY }, // token program
            ],
            data: new Uint8Array([CREATE_TOKEN, 9]), // 9 decimals
        };

        await sendInstruction(ix);

        const mintAccount = svm.getAccount(mint.address);
        if (!mintAccount.exists) throw new Error('Mint account not found');
        assert.equal(mintAccount.programAddress, TOKEN_PROGRAM_ADDRESS);
    });

    it('Mints tokens to the payer', async () => {
        const ix = {
            programAddress: programId,
            accounts: [
                { address: mint.address, role: AccountRole.WRITABLE }, // mint account
                { address: payerAta, role: AccountRole.WRITABLE }, // destination ATA
                { address: payer.address, role: AccountRole.READONLY_SIGNER, signer: payer }, // mint authority
                { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer }, // payer
                { address: payer.address, role: AccountRole.READONLY }, // wallet (ATA owner)
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY }, // system program
                { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY }, // token program
                { address: ASSOCIATED_TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY }, // ATA program
            ],
            data: new Uint8Array([MINT_TOKENS, ...u64.encode(150n)]),
        };

        await sendInstruction(ix);

        const ataAccount = svm.getAccount(payerAta);
        if (!ataAccount.exists) throw new Error('Associated token account not found');
        assert.equal(getTokenDecoder().decode(ataAccount.data).amount, 150n);
    });

    it('Transfers tokens to another wallet', async () => {
        const ix = {
            programAddress: programId,
            accounts: [
                { address: mint.address, role: AccountRole.READONLY }, // mint account
                { address: payerAta, role: AccountRole.WRITABLE }, // source ATA
                { address: recipientAta, role: AccountRole.WRITABLE }, // destination ATA
                { address: payer.address, role: AccountRole.READONLY_SIGNER, signer: payer }, // authority
                { address: recipient.address, role: AccountRole.READONLY }, // recipient wallet
                { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer }, // payer
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY }, // system program
                { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY }, // token program
                { address: ASSOCIATED_TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY }, // ATA program
            ],
            data: new Uint8Array([TRANSFER_TOKENS, ...u64.encode(50n)]),
        };

        await sendInstruction(ix);

        const sourceAccount = svm.getAccount(payerAta);
        const destinationAccount = svm.getAccount(recipientAta);
        if (!sourceAccount.exists || !destinationAccount.exists) {
            throw new Error('Associated token account not found');
        }
        assert.equal(getTokenDecoder().decode(sourceAccount.data).amount, 100n);
        assert.equal(getTokenDecoder().decode(destinationAccount.data).amount, 50n);
    });
});
