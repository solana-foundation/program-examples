import * as path from 'node:path';
import {
    AccountRole,
    type Address,
    appendTransactionMessageInstruction,
    appendTransactionMessageInstructions,
    createTransactionMessage,
    generateKeyPairSigner,
    type KeyPairSigner,
    lamports,
    pipe,
    setTransactionMessageFeePayerSigner,
    signTransactionMessageWithSigners,
} from '@solana/kit';
import { getCreateAccountInstruction, SYSTEM_PROGRAM_ADDRESS } from '@solana-program/system';
import {
    getDisableCpiGuardInstruction,
    getEnableCpiGuardInstruction,
    getInitializeAccount3Instruction,
    getInitializeMint2Instruction,
    getMintToInstruction,
    getTokenDecoder,
    TOKEN_2022_PROGRAM_ADDRESS,
} from '@solana-program/token-2022';
import { assert } from 'chai';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';

// A bare SPL Token-2022 mint (no extensions) is 82 bytes; a bare token account is 165.
const MINT_SIZE = 82n;
const TOKEN_ACCOUNT_SIZE = 165n;
// A token account with the CpiGuard extension:
//   base account length (165) + account-type byte (1) + CpiGuard TLV (5) = 171
// The CpiGuard value is a single `bool` (`lock_cpi`).
const CPI_GUARD_ACCOUNT_SIZE = 171n;

// The compiled program artifact, produced by `build-and-test` into ./fixtures.
// The npm scripts always run from the package root, so resolve from the cwd.
const PROGRAM_SO = path.join(process.cwd(), 'tests', 'fixtures', 'token_2022_cpi_guard_pinocchio_program.so');

describe('Token-2022 CPI Guard (Pinocchio)', () => {
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
        send(await signTransactionMessageWithSigners(tx), 'mint setup');
        return mint;
    }

    // Sends a signed transaction and throws with context on failure.
    function send(signedTx: Parameters<typeof svm.sendTransaction>[0], label: string) {
        const result = svm.sendTransaction(signedTx);
        if (result instanceof FailedTransactionMetadata) {
            throw new Error(`${label} failed: ${result.err()}`);
        }
    }

    // Invokes the example program's cpi_transfer (a TransferChecked CPI) from
    // `source` to `destination`, signed by the payer (the source's owner).
    function cpiTransferIx(payer: KeyPairSigner, source: Address, mint: Address, destination: Address) {
        return {
            programAddress: programId,
            accounts: [
                { address: source, role: AccountRole.WRITABLE }, // source token account
                { address: mint, role: AccountRole.READONLY }, // mint account
                { address: destination, role: AccountRole.WRITABLE }, // destination token account
                { address: payer.address, role: AccountRole.READONLY_SIGNER as const, signer: payer }, // authority (owner)
                { address: TOKEN_2022_PROGRAM_ADDRESS, role: AccountRole.READONLY }, // Token-2022 program
            ],
        };
    }

    it('Blocks a CPI transfer while CpiGuard is enabled and allows it once disabled', async () => {
        const payer = await generateKeyPairSigner();
        svm.airdrop(payer.address, lamports(1_000_000_000n));
        const decimals = 2;

        const mint = await createMint(payer, decimals);

        // Source account with CpiGuard enabled, funded with some tokens.
        const source = await generateKeyPairSigner();
        const sourceTx = pipe(
            createTransactionMessage({ version: 0 }),
            m => setTransactionMessageFeePayerSigner(payer, m),
            m => svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
            m =>
                appendTransactionMessageInstructions(
                    [
                        getCreateAccountInstruction({
                            payer,
                            newAccount: source,
                            lamports: svm.minimumBalanceForRentExemption(CPI_GUARD_ACCOUNT_SIZE),
                            space: CPI_GUARD_ACCOUNT_SIZE,
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
                        getEnableCpiGuardInstruction({ token: source.address, owner: payer }),
                    ],
                    m,
                ),
        );
        send(await signTransactionMessageWithSigners(sourceTx), 'source setup');

        // Plain destination account.
        const destination = await generateKeyPairSigner();
        const destTx = pipe(
            createTransactionMessage({ version: 0 }),
            m => setTransactionMessageFeePayerSigner(payer, m),
            m => svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
            m =>
                appendTransactionMessageInstructions(
                    [
                        getCreateAccountInstruction({
                            payer,
                            newAccount: destination,
                            lamports: svm.minimumBalanceForRentExemption(TOKEN_ACCOUNT_SIZE),
                            space: TOKEN_ACCOUNT_SIZE,
                            programAddress: TOKEN_2022_PROGRAM_ADDRESS,
                        }),
                        getInitializeAccount3Instruction({
                            account: destination.address,
                            mint: mint.address,
                            owner: payer.address,
                        }),
                    ],
                    m,
                ),
        );
        send(await signTransactionMessageWithSigners(destTx), 'destination setup');

        const transferIx = cpiTransferIx(payer, source.address, mint.address, destination.address);

        // While CpiGuard is enabled, the owner-authorized transfer via CPI is rejected.
        const blockedTx = pipe(
            createTransactionMessage({ version: 0 }),
            m => setTransactionMessageFeePayerSigner(payer, m),
            m => svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
            m => appendTransactionMessageInstruction(transferIx, m),
        );
        const blockedResult = svm.sendTransaction(await signTransactionMessageWithSigners(blockedTx));
        assert.instanceOf(blockedResult, FailedTransactionMetadata, 'expected the guarded CPI transfer to be rejected');

        // Disable CpiGuard, then the same CPI transfer succeeds.
        const disableTx = pipe(
            createTransactionMessage({ version: 0 }),
            m => setTransactionMessageFeePayerSigner(payer, m),
            m => svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
            m =>
                appendTransactionMessageInstruction(
                    getDisableCpiGuardInstruction({ token: source.address, owner: payer }),
                    m,
                ),
        );
        send(await signTransactionMessageWithSigners(disableTx), 'disable CpiGuard');

        // The retried transfer is otherwise byte-identical to the blocked one, so
        // advance the blockhash to give it a distinct signature.
        svm.expireBlockhash();
        const allowedTx = pipe(
            createTransactionMessage({ version: 0 }),
            m => setTransactionMessageFeePayerSigner(payer, m),
            m => svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
            m => appendTransactionMessageInstruction(transferIx, m),
        );
        send(await signTransactionMessageWithSigners(allowedTx), 'unguarded CPI transfer');

        const destAccount = svm.getAccount(destination.address);
        if (!destAccount?.exists) throw new Error('Destination account not found');
        const destState = getTokenDecoder().decode(destAccount.data);
        assert.equal(destState.amount, 1n);

        console.log('Source (CpiGuard) account:', source.address);
    });

    // Creates a plain (no-extension) Token-2022 token account owned by the payer,
    // optionally minting `amount` tokens into it.
    async function createTokenAccount(payer: KeyPairSigner, mint: Address, amount = 0n): Promise<Address> {
        const account = await generateKeyPairSigner();
        const tx = pipe(
            createTransactionMessage({ version: 0 }),
            m => setTransactionMessageFeePayerSigner(payer, m),
            m => svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
            m =>
                appendTransactionMessageInstructions(
                    [
                        getCreateAccountInstruction({
                            payer,
                            newAccount: account,
                            lamports: svm.minimumBalanceForRentExemption(TOKEN_ACCOUNT_SIZE),
                            space: TOKEN_ACCOUNT_SIZE,
                            programAddress: TOKEN_2022_PROGRAM_ADDRESS,
                        }),
                        getInitializeAccount3Instruction({ account: account.address, mint, owner: payer.address }),
                        ...(amount > 0n
                            ? [getMintToInstruction({ mint, token: account.address, mintAuthority: payer, amount })]
                            : []),
                    ],
                    m,
                ),
        );
        send(await signTransactionMessageWithSigners(tx), 'token account setup');
        return account.address;
    }

    it('Rejects a mint that Token-2022 does not own, before any CPI', async () => {
        const payer = await generateKeyPairSigner();
        svm.airdrop(payer.address, lamports(1_000_000_000n));

        const mint = await createMint(payer, 2);
        const source = await createTokenAccount(payer, mint.address, 100n);
        const destination = await createTokenAccount(payer, mint.address);

        // A byte-for-byte copy of the real mint, but owned by the System Program:
        // its decimals byte reads fine, so only the owner check can stop it.
        const realMint = svm.getAccount(mint.address);
        if (!realMint?.exists) throw new Error('Mint not found');
        const fakeMint = (await generateKeyPairSigner()).address;
        svm.setAccount({ ...realMint, address: fakeMint, programAddress: SYSTEM_PROGRAM_ADDRESS });

        const tx = pipe(
            createTransactionMessage({ version: 0 }),
            m => setTransactionMessageFeePayerSigner(payer, m),
            m => svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
            m => appendTransactionMessageInstruction(cpiTransferIx(payer, source, fakeMint, destination), m),
        );
        const result = svm.sendTransaction(await signTransactionMessageWithSigners(tx));
        assert.instanceOf(result, FailedTransactionMetadata, 'expected a non-Token-2022 mint to be rejected');

        // The program itself rejected it: Token-2022 was never invoked.
        const logs = result.meta().logs();
        assert.isTrue(
            logs.some(l => l.startsWith(`Program ${programId} failed`)),
            `expected the example program to fail; logs: ${logs.join(' | ')}`,
        );
        assert.isFalse(
            logs.some(l => l.startsWith(`Program ${TOKEN_2022_PROGRAM_ADDRESS} invoke`)),
            `expected no Token-2022 CPI; logs: ${logs.join(' | ')}`,
        );

        // Nothing moved.
        const destAccount = svm.getAccount(destination);
        if (!destAccount?.exists) throw new Error('Destination account not found');
        assert.equal(getTokenDecoder().decode(destAccount.data).amount, 0n);
    });
});
