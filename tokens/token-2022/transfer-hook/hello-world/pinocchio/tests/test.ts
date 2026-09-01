import * as path from 'node:path';
import {
    AccountRole,
    type Address,
    type KeyPairSigner,
    appendTransactionMessageInstruction,
    appendTransactionMessageInstructions,
    createTransactionMessage,
    generateKeyPairSigner,
    getAddressEncoder,
    getProgramDerivedAddress,
    lamports,
    pipe,
    setTransactionMessageFeePayerSigner,
    signTransactionMessageWithSigners,
    unwrapOption,
} from '@solana/kit';
import { SYSTEM_PROGRAM_ADDRESS } from '@solana-program/system';
import {
    ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
    findAssociatedTokenPda,
    getCreateAssociatedTokenInstruction,
    getMintDecoder,
    getMintToInstruction,
    getTokenDecoder,
    getTransferCheckedInstruction,
    TOKEN_2022_PROGRAM_ADDRESS,
} from '@solana-program/token-2022';
import { assert } from 'chai';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';

// A Token-2022 mint carrying the TransferHook extension:
//   base mint (82) padded to 165 + account-type byte (1) + TLV (2 + 2 + 64) = 234
const MINT_SIZE_WITH_TRANSFER_HOOK = 234;

// The serialized empty ExtraAccountMetaList the program writes: the 8-byte
// Execute discriminator, a u32 value length of 4, and a u32 account count of 0.
const EMPTY_EXTRA_ACCOUNT_METAS = Uint8Array.from([105, 37, 101, 197, 75, 251, 102, 26, 4, 0, 0, 0, 0, 0, 0, 0]);

// spl-transfer-hook-interface discriminators: sha256("spl-transfer-hook-interface:<ix>")[0..8].
const EXECUTE_DISCRIMINATOR = Uint8Array.from([105, 37, 101, 197, 75, 251, 102, 26]);
const INITIALIZE_EXTRA_ACCOUNT_META_LIST_DISCRIMINATOR = Uint8Array.from([43, 34, 13, 49, 167, 88, 235, 235]);

// This example's own instruction, which is not part of the interface.
const INITIALIZE_DISCRIMINATOR = 0;

const DECIMALS = 2;
const MINTED_AMOUNT = 100n * 100n; // 100 tokens
const TRANSFER_AMOUNT = 1n * 100n; // 1 token

const PROGRAM_SO = path.join(
    process.cwd(),
    'tests',
    'fixtures',
    'token_2022_transfer_hook_hello_world_pinocchio_program.so',
);
const addressEncoder = getAddressEncoder();

function u64(n: bigint): Uint8Array {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setBigUint64(0, n, true);
    return b;
}
// Walks the Token-2022 TLV list (which starts at offset 166 on both mints and
// token accounts) and returns where `type`'s value begins, so tests can patch a
// single extension field without rebuilding the whole account.
function tlvValueOffset(data: Uint8Array, type: number): number {
    let cursor = 166;
    while (cursor + 4 <= data.length) {
        const entryType = data[cursor] | (data[cursor + 1] << 8);
        if (entryType === 0) break;
        const length = data[cursor + 2] | (data[cursor + 3] << 8);
        if (entryType === type) return cursor + 4;
        cursor += 4 + length;
    }
    throw new Error(`extension ${type} not found`);
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let offset = 0;
    for (const p of parts) {
        out.set(p, offset);
        offset += p.length;
    }
    return out;
}

describe('Token-2022 Transfer Hook — Hello World (Pinocchio)', () => {
    let svm: LiteSVM;
    let programId: Address;
    let payer: KeyPairSigner;
    let mint: KeyPairSigner;
    let extraAccountMetaList: Address;
    let sourceTokenAccount: Address;
    let destinationTokenAccount: Address;
    let recipient: KeyPairSigner;

    before(async () => {
        svm = new LiteSVM();
        // The program derives its PDAs from the id it is invoked with and never
        // asserts a hardcoded one, so a generated id keeps the test self-contained.
        programId = (await generateKeyPairSigner()).address;
        svm.addProgramFromFile(programId, PROGRAM_SO);

        payer = await generateKeyPairSigner();
        svm.airdrop(payer.address, lamports(10_000_000_000n));

        mint = await generateKeyPairSigner();
        recipient = await generateKeyPairSigner();

        [extraAccountMetaList] = await getProgramDerivedAddress({
            programAddress: programId,
            seeds: ['extra-account-metas', addressEncoder.encode(mint.address)],
        });
        [sourceTokenAccount] = await findAssociatedTokenPda({
            owner: payer.address,
            mint: mint.address,
            tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
        });
        [destinationTokenAccount] = await findAssociatedTokenPda({
            owner: recipient.address,
            mint: mint.address,
            tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
        });
    });

    async function tx(instructions: Parameters<typeof appendTransactionMessageInstruction>[0][]) {
        return signTransactionMessageWithSigners(
            pipe(
                createTransactionMessage({ version: 0 }),
                m => setTransactionMessageFeePayerSigner(payer, m),
                m => svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
                m => appendTransactionMessageInstructions(instructions, m),
            ),
        );
    }

    function send(signedTx: Parameters<typeof svm.sendTransaction>[0], label: string) {
        const result = svm.sendTransaction(signedTx);
        if (result instanceof FailedTransactionMetadata) {
            throw new Error(`${label} failed: ${result.err()}`);
        }
        return result;
    }

    // Rewrites an existing account's data in place, keeping its owner. Used to
    // put a genuine Token-2022 account into a state a test cannot reach on its
    // own — a mint pointed at another hook, or an account mid-transfer.
    function rewriteAccount(address: Address, mutate: (data: Uint8Array) => void) {
        const account = svm.getAccount(address);
        if (!account?.exists) throw new Error(`account ${address} not found`);
        const data = new Uint8Array(account.data);
        mutate(data);
        svm.setAccount({
            address,
            data,
            executable: false,
            lamports: account.lamports,
            programAddress: account.programAddress,
            space: BigInt(data.length),
        });
    }

    function tokenAmount(account: Address): bigint {
        const acc = svm.getAccount(account);
        if (!acc?.exists) throw new Error('token account not found');
        return getTokenDecoder().decode(acc.data).amount;
    }

    it('Creates a mint with the transfer hook extension', async () => {
        const ix = {
            programAddress: programId,
            accounts: [
                { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
                { address: mint.address, role: AccountRole.WRITABLE_SIGNER, signer: mint },
                { address: TOKEN_2022_PROGRAM_ADDRESS, role: AccountRole.READONLY },
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ],
            data: Uint8Array.of(INITIALIZE_DISCRIMINATOR, DECIMALS),
        };
        send(await tx([ix]), 'initialize');

        const account = svm.getAccount(mint.address);
        if (!account?.exists) throw new Error('mint not found');
        assert.equal(account.programAddress, TOKEN_2022_PROGRAM_ADDRESS, 'mint is owned by Token-2022');
        assert.equal(account.data.length, MINT_SIZE_WITH_TRANSFER_HOOK, 'mint is sized for the TransferHook extension');

        // Decode with the official Token-2022 codec rather than reading offsets.
        const state = getMintDecoder().decode(account.data);
        assert.equal(state.decimals, DECIMALS);

        const extensions = unwrapOption(state.extensions) ?? [];
        const transferHook = extensions.find(e => e.__kind === 'TransferHook');
        if (transferHook?.__kind !== 'TransferHook') {
            throw new Error('TransferHook extension not found on the mint');
        }
        assert.equal(transferHook.authority, payer.address, 'payer is the hook authority');
        assert.equal(transferHook.programId, programId, 'the mint points at this program as its hook');
    });

    it('Creates the ExtraAccountMetaList account', async () => {
        // The list's address is publicly derivable from the mint, and
        // `CreateAccount` refuses to create over an account that already holds
        // lamports — so a stray lamport would otherwise block this mint from
        // ever being set up. Drop one there first.
        svm.setAccount({
            address: extraAccountMetaList,
            data: new Uint8Array(0),
            executable: false,
            lamports: lamports(1n),
            programAddress: SYSTEM_PROGRAM_ADDRESS,
            space: 0n,
        });

        const ix = {
            programAddress: programId,
            accounts: [
                { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
                { address: extraAccountMetaList, role: AccountRole.WRITABLE },
                { address: mint.address, role: AccountRole.READONLY },
                { address: TOKEN_2022_PROGRAM_ADDRESS, role: AccountRole.READONLY },
                { address: ASSOCIATED_TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ],
            data: INITIALIZE_EXTRA_ACCOUNT_META_LIST_DISCRIMINATOR,
        };
        send(await tx([ix]), 'initialize extra account meta list');

        const account = svm.getAccount(extraAccountMetaList);
        if (!account?.exists) throw new Error('extra account meta list not found');
        assert.equal(account.programAddress, programId, 'the list is owned by the hook program');
        assert.deepEqual(
            Array.from(account.data),
            Array.from(EMPTY_EXTRA_ACCOUNT_METAS),
            'the list is keyed by the Execute discriminator and holds no extra accounts',
        );
    });

    it('Creates token accounts and mints tokens', async () => {
        send(
            await tx([
                getCreateAssociatedTokenInstruction({
                    payer,
                    ata: sourceTokenAccount,
                    owner: payer.address,
                    mint: mint.address,
                    tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
                }),
                getCreateAssociatedTokenInstruction({
                    payer,
                    ata: destinationTokenAccount,
                    owner: recipient.address,
                    mint: mint.address,
                    tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
                }),
                getMintToInstruction(
                    {
                        mint: mint.address,
                        token: sourceTokenAccount,
                        mintAuthority: payer,
                        amount: MINTED_AMOUNT,
                    },
                    { programAddress: TOKEN_2022_PROGRAM_ADDRESS },
                ),
            ]),
            'create token accounts and mint',
        );

        assert.equal(tokenAmount(sourceTokenAccount), MINTED_AMOUNT, 'source funded');
    });

    it('Runs the hook on a transfer', async () => {
        // Token-2022 resolves the hook's accounts from the ExtraAccountMetaList,
        // but the transfer instruction must still carry the hook program and that
        // list. With no extra accounts to resolve, those two are all that is added.
        const base = getTransferCheckedInstruction(
            {
                source: sourceTokenAccount,
                mint: mint.address,
                destination: destinationTokenAccount,
                authority: payer,
                amount: TRANSFER_AMOUNT,
                decimals: DECIMALS,
            },
            { programAddress: TOKEN_2022_PROGRAM_ADDRESS },
        );
        const transferIx = {
            ...base,
            accounts: [
                ...base.accounts,
                { address: programId, role: AccountRole.READONLY },
                { address: extraAccountMetaList, role: AccountRole.READONLY },
            ],
        };

        const result = send(await tx([transferIx]), 'transfer with hook');

        assert.equal(tokenAmount(sourceTokenAccount), MINTED_AMOUNT - TRANSFER_AMOUNT, 'source debited');
        assert.equal(tokenAmount(destinationTokenAccount), TRANSFER_AMOUNT, 'destination credited');

        // The hook really ran, rather than the transfer simply bypassing it.
        const logs = result.logs().join('\n');
        assert.include(logs, 'Hello Transfer Hook!', 'the hook logged from inside the transfer');
    });

    it('Rejects calling the hook outside a transfer', async () => {
        // Same accounts Token-2022 would pass, but invoked directly. The source
        // account's `transferring` flag is only set mid-transfer, so this fails.
        const ix = {
            programAddress: programId,
            accounts: [
                { address: sourceTokenAccount, role: AccountRole.READONLY },
                { address: mint.address, role: AccountRole.READONLY },
                { address: destinationTokenAccount, role: AccountRole.READONLY },
                { address: payer.address, role: AccountRole.READONLY },
                { address: extraAccountMetaList, role: AccountRole.READONLY },
            ],
            data: concatBytes(EXECUTE_DISCRIMINATOR, u64(TRANSFER_AMOUNT)),
        };

        const result = svm.sendTransaction(await tx([ix]));
        assert.instanceOf(result, FailedTransactionMetadata, 'expected the direct hook call to be rejected');

        // Pin the reason: the hook must reject with IsNotCurrentlyTransferring
        // (custom error 0) after entering Execute, not fail for some other cause.
        const logs = (result as FailedTransactionMetadata).meta().logs().join('\n');
        assert.include(logs, 'Instruction: Execute', 'the hook was reached');
        assert.include(logs, 'custom program error: 0x0', 'rejected with IsNotCurrentlyTransferring');
        assert.notInclude(logs, 'Hello Transfer Hook!', 'the hook body did not run');
    });

    it('Rejects a forged source account claiming to be transferring', async () => {
        // The `transferring` flag is only trustworthy because Token-2022 wrote
        // it. Hand-build an account that carries the right bytes at the right
        // offsets — a TransferHookAccount TLV (type 15) with transferring = 1,
        // naming the real mint — but is owned by someone else.
        const forged = new Uint8Array(171);
        forged.set(addressEncoder.encode(mint.address), 0); // mint
        forged.set(addressEncoder.encode(payer.address), 32); // owner
        forged[165] = 2; // account type: Account
        forged[166] = 15; // TLV type: TransferHookAccount (u16 LE)
        forged[167] = 0;
        forged[168] = 1; // TLV length: 1 (u16 LE)
        forged[169] = 0;
        forged[170] = 1; // transferring = true

        const attacker = await generateKeyPairSigner();
        const forgedSource = (await generateKeyPairSigner()).address;
        svm.setAccount({
            address: forgedSource,
            data: forged,
            executable: false,
            lamports: lamports(svm.minimumBalanceForRentExemption(BigInt(forged.length))),
            programAddress: attacker.address, // not Token-2022
            space: BigInt(forged.length),
        });

        const ix = {
            programAddress: programId,
            accounts: [
                { address: forgedSource, role: AccountRole.READONLY },
                { address: mint.address, role: AccountRole.READONLY },
                { address: destinationTokenAccount, role: AccountRole.READONLY },
                { address: payer.address, role: AccountRole.READONLY },
                { address: extraAccountMetaList, role: AccountRole.READONLY },
            ],
            data: concatBytes(EXECUTE_DISCRIMINATOR, u64(TRANSFER_AMOUNT)),
        };

        const result = svm.sendTransaction(await tx([ix]));
        assert.instanceOf(result, FailedTransactionMetadata, 'expected the forged source account to be rejected');

        // Rejected as an invalid source account (custom error 3) — the forged
        // transferring flag must never reach the hook body.
        const logs = (result as FailedTransactionMetadata).meta().logs().join('\n');
        assert.include(logs, 'custom program error: 0x3', 'rejected with InvalidSourceAccount');
        assert.notInclude(logs, 'Hello Transfer Hook!', 'the hook body did not run');
    });

    it('Rejects a mint configured with a different hook program', async () => {
        // A mint whose hook is some *other* program is mid-transfer too while
        // that program runs, and that program can CPI here with the genuine
        // source account — passing the ownership, mint and transferring checks.
        // Only the mint's own TransferHook config distinguishes the two cases.
        const otherMint = await generateKeyPairSigner();
        const otherHookProgram = (await generateKeyPairSigner()).address;

        const initOtherMintIx = {
            programAddress: programId,
            accounts: [
                { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
                { address: otherMint.address, role: AccountRole.WRITABLE_SIGNER, signer: otherMint },
                { address: TOKEN_2022_PROGRAM_ADDRESS, role: AccountRole.READONLY },
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ],
            data: Uint8Array.of(INITIALIZE_DISCRIMINATOR, DECIMALS),
        };
        send(await tx([initOtherMintIx]), 'initialize other mint');

        // Repoint the genuine mint at the other hook program: the extension
        // value is `authority (32) || hook program (32)`.
        rewriteAccount(otherMint.address, data => {
            data.set(addressEncoder.encode(otherHookProgram), tlvValueOffset(data, 14) + 32);
        });

        const [otherSource] = await findAssociatedTokenPda({
            owner: payer.address,
            mint: otherMint.address,
            tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
        });
        send(
            await tx([
                getCreateAssociatedTokenInstruction(
                    { payer, ata: otherSource, owner: payer.address, mint: otherMint.address },
                    { programAddress: ASSOCIATED_TOKEN_PROGRAM_ADDRESS },
                ),
            ]),
            'create other source token account',
        );

        // Put it mid-transfer, exactly as Token-2022 would for the other hook.
        rewriteAccount(otherSource, data => {
            data[tlvValueOffset(data, 15)] = 1;
        });

        const [otherMetaList] = await getProgramDerivedAddress({
            programAddress: programId,
            seeds: ['extra-account-metas', addressEncoder.encode(otherMint.address)],
        });

        const ix = {
            programAddress: programId,
            accounts: [
                { address: otherSource, role: AccountRole.READONLY },
                { address: otherMint.address, role: AccountRole.READONLY },
                { address: otherSource, role: AccountRole.READONLY },
                { address: payer.address, role: AccountRole.READONLY },
                { address: otherMetaList, role: AccountRole.READONLY },
            ],
            data: concatBytes(EXECUTE_DISCRIMINATOR, u64(TRANSFER_AMOUNT)),
        };

        const result = svm.sendTransaction(await tx([ix]));
        assert.instanceOf(result, FailedTransactionMetadata, 'expected a foreign hook mint to be rejected');

        // Rejected as an unexpected hook config (custom error 2).
        const logs = (result as FailedTransactionMetadata).meta().logs().join('\n');
        assert.include(logs, 'custom program error: 0x2', 'rejected with UnexpectedTransferHookConfig');
        assert.notInclude(logs, 'Hello Transfer Hook!', 'the hook body did not run');
    });
});
