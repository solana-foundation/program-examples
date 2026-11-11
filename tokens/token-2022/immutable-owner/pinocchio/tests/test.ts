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
import {
    AuthorityType,
    getInitializeMint2Instruction,
    getSetAuthorityInstruction,
    getTokenDecoder,
    TOKEN_2022_PROGRAM_ADDRESS,
} from '@solana-program/token-2022';
import { assert } from 'chai';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';

// A bare SPL Token-2022 mint (no extensions) is 82 bytes.
const MINT_SIZE = 82n;
// Token-2022 lays a token account with one extension out as:
//   base account length (165) + account-type byte (1) + ImmutableOwner TLV (4) = 170
const EXTENDED_ACCOUNT_SIZE = 170;

// The compiled program artifact, produced by `build-and-test` into ./fixtures.
// The npm scripts always run from the package root, so resolve from the cwd.
const PROGRAM_SO = path.join(process.cwd(), 'tests', 'fixtures', 'token_2022_immutable_owner_pinocchio_program.so');

describe('Token-2022 Immutable Owner (Pinocchio)', () => {
    let svm: LiteSVM;
    let programId: Address;

    before(async () => {
        svm = new LiteSVM();
        // The program never asserts its own id, so any address works; a generated
        // one keeps the test self-contained.
        programId = (await generateKeyPairSigner()).address;
        svm.addProgramFromFile(programId, PROGRAM_SO);
    });

    it('Creates a Token-2022 token account with the ImmutableOwner extension', async () => {
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

        const tokenAccount = await generateKeyPairSigner();
        // A distinct key for the owner so the stored-owner assertion verifies it
        // is sourced from account index 2, not the payer.
        const owner = await generateKeyPairSigner();

        const ix = {
            programAddress: programId,
            accounts: [
                { address: tokenAccount.address, role: AccountRole.WRITABLE_SIGNER as const, signer: tokenAccount }, // token account
                { address: mint.address, role: AccountRole.READONLY }, // mint account
                { address: owner.address, role: AccountRole.READONLY }, // owner
                { address: payer.address, role: AccountRole.WRITABLE_SIGNER as const, signer: payer }, // payer
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
        assert.equal(state.owner, owner.address);

        const extensions = unwrapOption(state.extensions) ?? [];
        const immutableOwner = extensions.find(e => e.__kind === 'ImmutableOwner');
        if (immutableOwner?.__kind !== 'ImmutableOwner') {
            throw new Error('ImmutableOwner extension not found on the token account');
        }

        console.log('Token account address:', tokenAccount.address);
    });

    it('Rejects changing the owner of an immutable account', async () => {
        const payer = await generateKeyPairSigner();
        svm.airdrop(payer.address, lamports(1_000_000_000n));

        // Fresh mint + immutable-owner account owned by `owner`.
        const mint = await generateKeyPairSigner();
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
                            decimals: 2,
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

        const tokenAccount = await generateKeyPairSigner();
        const owner = await generateKeyPairSigner();
        const createIx = {
            programAddress: programId,
            accounts: [
                { address: tokenAccount.address, role: AccountRole.WRITABLE_SIGNER as const, signer: tokenAccount },
                { address: mint.address, role: AccountRole.READONLY },
                { address: owner.address, role: AccountRole.READONLY },
                { address: payer.address, role: AccountRole.WRITABLE_SIGNER as const, signer: payer },
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
                { address: TOKEN_2022_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ],
        };
        const createTx = pipe(
            createTransactionMessage({ version: 0 }),
            m => setTransactionMessageFeePayerSigner(payer, m),
            m => svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
            m => appendTransactionMessageInstruction(createIx, m),
        );
        const createResult = svm.sendTransaction(await signTransactionMessageWithSigners(createTx));
        if (createResult instanceof FailedTransactionMetadata) {
            throw new Error(`Account setup failed: ${createResult.err()}`);
        }

        // Try to reassign the account owner, Token-2022 must reject this because
        // the account carries the ImmutableOwner extension.
        const newOwner = await generateKeyPairSigner();
        const setAuthorityTx = pipe(
            createTransactionMessage({ version: 0 }),
            m => setTransactionMessageFeePayerSigner(payer, m),
            m => svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
            m =>
                appendTransactionMessageInstruction(
                    getSetAuthorityInstruction({
                        owned: tokenAccount.address,
                        owner,
                        authorityType: AuthorityType.AccountOwner,
                        newAuthority: newOwner.address,
                    }),
                    m,
                ),
        );
        const result = svm.sendTransaction(await signTransactionMessageWithSigners(setAuthorityTx));
        assert.instanceOf(result, FailedTransactionMetadata, 'expected the owner change to be rejected');
    });
});
