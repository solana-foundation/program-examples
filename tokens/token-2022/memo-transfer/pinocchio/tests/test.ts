import * as path from 'node:path';
import {
    AccountRole,
    type Address,
    address,
    appendTransactionMessageInstruction,
    appendTransactionMessageInstructions,
    createTransactionMessage,
    generateKeyPairSigner,
    type KeyPairSigner,
    lamports,
    pipe,
    setTransactionMessageFeePayerSigner,
    signTransactionMessageWithSigners,
    unwrapOption,
} from '@solana/kit';
import { getCreateAccountInstruction, SYSTEM_PROGRAM_ADDRESS } from '@solana-program/system';
import {
    getInitializeAccount3Instruction,
    getInitializeMint2Instruction,
    getMintToInstruction,
    getTokenDecoder,
    getTransferCheckedInstruction,
    TOKEN_2022_PROGRAM_ADDRESS,
} from '@solana-program/token-2022';
import { assert } from 'chai';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';

// A bare SPL Token-2022 mint (no extensions) is 82 bytes; a bare token account is 165.
const MINT_SIZE = 82n;
const TOKEN_ACCOUNT_SIZE = 165n;
// Token-2022 lays a token account with one extension out as:
//   base account length (165) + account-type byte (1) + MemoTransfer TLV (5) = 171
const EXTENDED_ACCOUNT_SIZE = 171;
// The SPL Memo program, bundled by LiteSVM.
const MEMO_PROGRAM_ADDRESS = address('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

// The compiled program artifact, produced by `build-and-test` into ./fixtures.
// The npm scripts always run from the package root, so resolve from the cwd.
const PROGRAM_SO = path.join(process.cwd(), 'tests', 'fixtures', 'token_2022_memo_transfer_pinocchio_program.so');

describe('Token-2022 Memo Transfer (Pinocchio)', () => {
    let svm: LiteSVM;
    let programId: Address;

    before(async () => {
        svm = new LiteSVM();
        // The program never asserts its own id, so any address works; a generated
        // one keeps the test self-contained.
        programId = (await generateKeyPairSigner()).address;
        svm.addProgramFromFile(programId, PROGRAM_SO);
    });

    // Creates a plain (no-extension) Token-2022 mint whose authority is the payer.
    async function createMint(payer: KeyPairSigner, decimals: number): Promise<KeyPairSigner> {
        const mint = await generateKeyPairSigner();
        const tx = pipe(
            createTransactionMessage({ version: 0 }),
            m => setTransactionMessageFeePayerSigner(payer, m),
            m => svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
            m =>
                appendTransactionMessageInstructions(
                    [
                        getCreateAccountInstruction({
                            payer,
                            newAccount: mint,
                            lamports: svm.minimumBalanceForRentExemption(MINT_SIZE),
                            space: MINT_SIZE,
                            programAddress: TOKEN_2022_PROGRAM_ADDRESS,
                        }),
                        getInitializeMint2Instruction({
                            mint: mint.address,
                            decimals,
                            mintAuthority: payer.address,
                            freezeAuthority: null,
                        }),
                    ],
                    m,
                ),
        );
        const result = svm.sendTransaction(await signTransactionMessageWithSigners(tx));
        if (result instanceof FailedTransactionMetadata) {
            throw new Error(`Mint setup failed: ${result.err()}`);
        }
        return mint;
    }

    // Invokes the example program to create a token account with required memo
    // transfers enabled (owner = payer).
    async function createMemoAccount(payer: KeyPairSigner, mint: Address): Promise<KeyPairSigner> {
        const tokenAccount = await generateKeyPairSigner();
        const ix = {
            programAddress: programId,
            accounts: [
                { address: tokenAccount.address, role: AccountRole.WRITABLE_SIGNER, signer: tokenAccount }, // token account
                { address: mint, role: AccountRole.READONLY }, // mint account
                { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer }, // payer (owner)
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY }, // system program
                { address: TOKEN_2022_PROGRAM_ADDRESS, role: AccountRole.READONLY }, // Token-2022 program
            ],
        };
        const tx = pipe(
            createTransactionMessage({ version: 0 }),
            m => setTransactionMessageFeePayerSigner(payer, m),
            m => svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
            m => appendTransactionMessageInstruction(ix, m),
        );
        const result = svm.sendTransaction(await signTransactionMessageWithSigners(tx));
        if (result instanceof FailedTransactionMetadata) {
            throw new Error(`Account creation failed: ${result.err()}`);
        }
        return tokenAccount;
    }

    it('Creates a Token-2022 token account with required memo transfers enabled', async () => {
        const payer = await generateKeyPairSigner();
        svm.airdrop(payer.address, lamports(1_000_000_000n));

        const mint = await createMint(payer, 2);
        const tokenAccount = await createMemoAccount(payer, mint.address);

        const account = svm.getAccount(tokenAccount.address);
        if (!account?.exists) throw new Error('Token account not found');

        // Owned by Token-2022, and sized for exactly one extension.
        assert.equal(account.programAddress, TOKEN_2022_PROGRAM_ADDRESS);
        assert.equal(account.data.length, EXTENDED_ACCOUNT_SIZE);

        // Decode the base account fields and its TLV extensions with the official
        // Token-2022 codec instead of reading raw byte offsets by hand.
        const state = getTokenDecoder().decode(account.data);
        assert.equal(state.mint, mint.address);
        assert.equal(state.owner, payer.address);

        const extensions = unwrapOption(state.extensions) ?? [];
        const memoTransfer = extensions.find(e => e.__kind === 'MemoTransfer');
        if (memoTransfer?.__kind !== 'MemoTransfer') {
            throw new Error('MemoTransfer extension not found on the token account');
        }

        // The extension was enabled by the post-init CPI.
        assert.equal(memoTransfer.requireIncomingTransferMemos, true);

        console.log('Token account address:', tokenAccount.address);
    });

    it('Requires a memo on incoming transfers', async () => {
        const payer = await generateKeyPairSigner();
        svm.airdrop(payer.address, lamports(1_000_000_000n));
        const decimals = 2;

        const mint = await createMint(payer, decimals);

        // A plain source account (no extension) funded with some tokens.
        const source = await generateKeyPairSigner();
        const fundTx = pipe(
            createTransactionMessage({ version: 0 }),
            m => setTransactionMessageFeePayerSigner(payer, m),
            m => svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
            m =>
                appendTransactionMessageInstructions(
                    [
                        getCreateAccountInstruction({
                            payer,
                            newAccount: source,
                            lamports: svm.minimumBalanceForRentExemption(TOKEN_ACCOUNT_SIZE),
                            space: TOKEN_ACCOUNT_SIZE,
                            programAddress: TOKEN_2022_PROGRAM_ADDRESS,
                        }),
                        getInitializeAccount3Instruction({
                            account: source.address,
                            mint: mint.address,
                            owner: payer.address,
                        }),
                        getMintToInstruction({
                            mint: mint.address,
                            token: source.address,
                            mintAuthority: payer,
                            amount: 100n,
                        }),
                    ],
                    m,
                ),
        );
        const fundResult = svm.sendTransaction(await signTransactionMessageWithSigners(fundTx));
        if (fundResult instanceof FailedTransactionMetadata) {
            throw new Error(`Source funding failed: ${fundResult.err()}`);
        }

        // Destination account requires a memo on incoming transfers.
        const destination = await createMemoAccount(payer, mint.address);

        const transferIx = getTransferCheckedInstruction({
            source: source.address,
            mint: mint.address,
            destination: destination.address,
            authority: payer,
            amount: 10n,
            decimals,
        });

        // Without a preceding memo, Token-2022 rejects the transfer.
        const noMemoTx = pipe(
            createTransactionMessage({ version: 0 }),
            m => setTransactionMessageFeePayerSigner(payer, m),
            m => svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
            m => appendTransactionMessageInstruction(transferIx, m),
        );
        const noMemoResult = svm.sendTransaction(await signTransactionMessageWithSigners(noMemoTx));
        assert.instanceOf(noMemoResult, FailedTransactionMetadata, 'a transfer without a memo should be rejected');

        // Preceded by a memo instruction in the same transaction, it succeeds.
        const memoIx = { programAddress: MEMO_PROGRAM_ADDRESS, accounts: [], data: new TextEncoder().encode('gm') };
        const memoTx = pipe(
            createTransactionMessage({ version: 0 }),
            m => setTransactionMessageFeePayerSigner(payer, m),
            m => svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
            m => appendTransactionMessageInstructions([memoIx, transferIx], m),
        );
        const memoResult = svm.sendTransaction(await signTransactionMessageWithSigners(memoTx));
        if (memoResult instanceof FailedTransactionMetadata) {
            throw new Error(`Transfer with a memo failed: ${memoResult.err()}`);
        }

        const destAccount = svm.getAccount(destination.address);
        if (!destAccount?.exists) throw new Error('Destination account not found');
        const destState = getTokenDecoder().decode(destAccount.data);
        assert.equal(destState.amount, 10n);
    });
});
