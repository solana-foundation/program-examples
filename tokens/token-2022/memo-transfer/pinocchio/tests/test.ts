import * as path from 'node:path';
import {
    AccountRole,
    type Address,
    appendTransactionMessageInstruction,
    appendTransactionMessageInstructions,
    createTransactionMessage,
    generateKeyPairSigner,
    lamports,
    pipe,
    setTransactionMessageFeePayerSigner,
    signTransactionMessageWithSigners,
    unwrapOption,
} from '@solana/kit';
import { getCreateAccountInstruction, SYSTEM_PROGRAM_ADDRESS } from '@solana-program/system';
import { getInitializeMint2Instruction, getTokenDecoder, TOKEN_2022_PROGRAM_ADDRESS } from '@solana-program/token-2022';
import { assert } from 'chai';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';

// A bare SPL Token-2022 mint (no extensions) is 82 bytes.
const MINT_SIZE = 82n;
// Token-2022 lays a token account with one extension out as:
//   base account length (165) + account-type byte (1) + MemoTransfer TLV (5) = 171
const EXTENDED_ACCOUNT_SIZE = 171;

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

    it('Creates a Token-2022 token account with required memo transfers enabled', async () => {
        const payer = await generateKeyPairSigner();
        svm.airdrop(payer.address, lamports(1_000_000_000n));

        // Create a plain Token-2022 mint for the account to reference. The mint
        // authority is the payer; no freeze authority.
        const mint = await generateKeyPairSigner();
        const decimals = 2;
        const mintTx = pipe(
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
        const mintResult = svm.sendTransaction(await signTransactionMessageWithSigners(mintTx));
        if (mintResult instanceof FailedTransactionMetadata) {
            throw new Error(`Mint setup failed: ${mintResult.err()}`);
        }

        // The payer is the account owner, so it signs the post-init enable.
        const tokenAccount = await generateKeyPairSigner();
        const ix = {
            programAddress: programId,
            accounts: [
                { address: tokenAccount.address, role: AccountRole.WRITABLE_SIGNER, signer: tokenAccount }, // token account
                { address: mint.address, role: AccountRole.READONLY }, // mint account
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
            throw new Error(`Transaction failed: ${result.err()}`);
        }

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
});
