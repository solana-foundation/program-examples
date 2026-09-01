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
import { SYSTEM_PROGRAM_ADDRESS, getTransferSolInstruction } from '@solana-program/system';
import {
    ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
    TOKEN_2022_PROGRAM_ADDRESS,
    TOKEN_PROGRAM_ADDRESS,
    findAssociatedTokenPda,
    getApproveInstruction,
    getCreateAssociatedTokenInstruction,
    getMintDecoder,
    getMintToInstruction,
    getSyncNativeInstruction,
    getTokenDecoder,
    getTransferCheckedInstruction,
} from '@solana-program/token-2022';
import { assert } from 'chai';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';

// A Token-2022 mint carrying the TransferHook extension:
//   base mint (82) padded to 165 + account-type byte (1) + TLV (2 + 2 + 64) = 234
const MINT_SIZE_WITH_TRANSFER_HOOK = 234;

// spl-transfer-hook-interface discriminators: sha256("spl-transfer-hook-interface:<ix>")[0..8].
const EXECUTE_DISCRIMINATOR = Uint8Array.from([105, 37, 101, 197, 75, 251, 102, 26]);
const INITIALIZE_EXTRA_ACCOUNT_META_LIST_DISCRIMINATOR = Uint8Array.from([43, 34, 13, 49, 167, 88, 235, 235]);

// This example's own instruction, which is not part of the interface.
const INITIALIZE_DISCRIMINATOR = 0;

// Wrapped SOL. LiteSVM does not seed the native mint, so the suite creates it.
const NATIVE_MINT = 'So11111111111111111111111111111111111111112' as Address;
const NATIVE_MINT_DECIMALS = 9;
const SPL_MINT_SIZE = 82n;

const DECIMALS = 2;
const MINTED_AMOUNT = 100n * 100n; // 100 tokens
const TRANSFER_AMOUNT = 1n * 100n; // 1 token
// The hook charges a wSOL fee equal to the token amount, so the sender needs a
// funded wSOL account and an allowance the delegate can spend from.
const WSOL_FUNDING = 1_000_000_000n;

const PROGRAM_SO = path.join(
    process.cwd(),
    'tests',
    'fixtures',
    'token_2022_transfer_hook_transfer_cost_pinocchio_program.so',
);
const addressEncoder = getAddressEncoder();

function u32(n: number): number[] {
    return [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff];
}
function u64(n: bigint): Uint8Array {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setBigUint64(0, n, true);
    return b;
}
function ascii(s: string): number[] {
    return Array.from(s, c => c.charCodeAt(0));
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

// One serialized ExtraAccountMeta: a kind byte, a 32-byte address config, then
// is_signer and is_writable. Nothing this hook resolves ever signs.
function extraAccountMeta(kind: number, config: number[], isWritable: boolean): number[] {
    const addressConfig = new Array<number>(32).fill(0);
    config.forEach((b, i) => (addressConfig[i] = b));
    return [kind, ...addressConfig, 0, isWritable ? 1 : 0];
}

describe('Token-2022 Transfer Hook — Transfer Cost (Pinocchio)', () => {
    let svm: LiteSVM;
    let programId: Address;
    let payer: KeyPairSigner;
    let mint: KeyPairSigner;
    let extraAccountMetaList: Address;
    let counter: Address;
    let delegate: Address;
    let delegateWsol: Address;
    let senderWsol: Address;
    let sourceTokenAccount: Address;
    let destinationTokenAccount: Address;
    let recipient: KeyPairSigner;

    // The seven accounts the ExtraAccountMetaList resolves, in list order. This
    // mirrors what the program writes, so a mismatch fails the comparison in
    // "Creates the ExtraAccountMetaList account" rather than somewhere obscure.
    function expectedExtraAccountMetas(): Uint8Array {
        return Uint8Array.from([
            ...EXECUTE_DISCRIMINATOR,
            ...u32(4 + 7 * 35),
            ...u32(7),
            ...extraAccountMeta(0, [...addressEncoder.encode(NATIVE_MINT)], false),
            ...extraAccountMeta(0, [...addressEncoder.encode(TOKEN_PROGRAM_ADDRESS)], false),
            ...extraAccountMeta(0, [...addressEncoder.encode(ASSOCIATED_TOKEN_PROGRAM_ADDRESS)], false),
            // Seed::Literal("delegate") — a PDA of the hook program.
            ...extraAccountMeta(1, [1, 8, ...ascii('delegate')], true),
            // External PDA of account 7 (the associated token program), seeded
            // by the addresses of accounts 8, 6 and 5 — owner, token program,
            // mint. That is exactly how an ATA is derived.
            ...extraAccountMeta(128 | 7, [3, 8, 3, 6, 3, 5], true),
            ...extraAccountMeta(128 | 7, [3, 3, 3, 6, 3, 5], true),
            ...extraAccountMeta(1, [1, 7, ...ascii('counter')], true),
        ]);
    }

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

        // LiteSVM starts without the native mint, so stand one up by hand:
        // an SPL mint with no mint or freeze authority and 9 decimals.
        const nativeMintData = new Uint8Array(Number(SPL_MINT_SIZE));
        nativeMintData[44] = NATIVE_MINT_DECIMALS;
        nativeMintData[45] = 1; // is_initialized
        svm.setAccount({
            address: NATIVE_MINT,
            data: nativeMintData,
            executable: false,
            lamports: lamports(svm.minimumBalanceForRentExemption(SPL_MINT_SIZE)),
            programAddress: TOKEN_PROGRAM_ADDRESS,
            space: SPL_MINT_SIZE,
        });

        [extraAccountMetaList] = await getProgramDerivedAddress({
            programAddress: programId,
            seeds: ['extra-account-metas', addressEncoder.encode(mint.address)],
        });
        [counter] = await getProgramDerivedAddress({
            programAddress: programId,
            seeds: ['counter'],
        });
        [delegate] = await getProgramDerivedAddress({
            programAddress: programId,
            seeds: ['delegate'],
        });
        [delegateWsol] = await findAssociatedTokenPda({
            owner: delegate,
            mint: NATIVE_MINT,
            tokenProgram: TOKEN_PROGRAM_ADDRESS,
        });
        [senderWsol] = await findAssociatedTokenPda({
            owner: payer.address,
            mint: NATIVE_MINT,
            tokenProgram: TOKEN_PROGRAM_ADDRESS,
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

    // The counter account is a bare little-endian u64 — no Anchor discriminator.
    function counterValue(): bigint {
        const account = svm.getAccount(counter);
        if (!account?.exists) throw new Error('counter not found');
        return new DataView(account.data.buffer, account.data.byteOffset, 8).getBigUint64(0, true);
    }

    function tokenAmount(account: Address): bigint {
        const acc = svm.getAccount(account);
        if (!acc?.exists) throw new Error('token account not found');
        return getTokenDecoder().decode(acc.data).amount;
    }

    // The seven accounts the hook resolves, in the order the list names them.
    function feeAccounts() {
        return [
            { address: NATIVE_MINT, role: AccountRole.READONLY },
            { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            { address: ASSOCIATED_TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            { address: delegate, role: AccountRole.WRITABLE },
            { address: delegateWsol, role: AccountRole.WRITABLE },
            { address: senderWsol, role: AccountRole.WRITABLE },
            { address: counter, role: AccountRole.WRITABLE },
        ];
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

        const state = getMintDecoder().decode(account.data);
        assert.equal(state.decimals, DECIMALS);

        const extensions = unwrapOption(state.extensions) ?? [];
        const transferHook = extensions.find(e => e.__kind === 'TransferHook');
        if (transferHook?.__kind !== 'TransferHook') {
            throw new Error('TransferHook extension not found on the mint');
        }
        assert.equal(transferHook.programId, programId, 'the mint points at this program as its hook');
    });

    it('Creates the ExtraAccountMetaList account', async () => {
        // Both PDAs below have publicly derivable addresses, and `CreateAccount`
        // refuses to create over an account that already holds lamports — so a
        // stray lamport on either would otherwise block setup for this mint
        // permanently. Drop one on each first.
        for (const address of [extraAccountMetaList, counter]) {
            svm.setAccount({
                address,
                data: new Uint8Array(0),
                executable: false,
                lamports: lamports(1n),
                programAddress: SYSTEM_PROGRAM_ADDRESS,
                space: 0n,
            });
        }

        const ix = {
            programAddress: programId,
            accounts: [
                { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
                { address: extraAccountMetaList, role: AccountRole.WRITABLE },
                { address: mint.address, role: AccountRole.READONLY },
                { address: counter, role: AccountRole.WRITABLE },
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
            Array.from(expectedExtraAccountMetas()),
            'the list resolves the wSOL mint, the two programs, the delegate, both wSOL accounts and the counter',
        );

        assert.equal(counterValue(), 0n, 'the counter starts at zero');
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

    it('Funds wrapped SOL and approves the delegate', async () => {
        // The fee moves between wSOL accounts, so both must exist, and the
        // sender's must carry a balance. Wrapping is the usual dance: send
        // lamports to the token account, then SyncNative to credit them.
        send(
            await tx([
                getCreateAssociatedTokenInstruction({
                    payer,
                    ata: senderWsol,
                    owner: payer.address,
                    mint: NATIVE_MINT,
                    tokenProgram: TOKEN_PROGRAM_ADDRESS,
                }),
                getCreateAssociatedTokenInstruction({
                    payer,
                    ata: delegateWsol,
                    owner: delegate,
                    mint: NATIVE_MINT,
                    tokenProgram: TOKEN_PROGRAM_ADDRESS,
                }),
                getTransferSolInstruction({ source: payer, destination: senderWsol, amount: lamports(WSOL_FUNDING) }),
                getSyncNativeInstruction({ account: senderWsol }, { programAddress: TOKEN_PROGRAM_ADDRESS }),
                // The hook signs as the delegate PDA, so the sender has to
                // approve it first — Token-2022 does not forward the transfer's
                // own signer into the hook.
                getApproveInstruction(
                    { source: senderWsol, delegate, owner: payer, amount: WSOL_FUNDING },
                    { programAddress: TOKEN_PROGRAM_ADDRESS },
                ),
            ]),
            'fund wrapped SOL and approve the delegate',
        );

        assert.equal(tokenAmount(senderWsol), WSOL_FUNDING, 'sender wSOL funded');
        assert.equal(tokenAmount(delegateWsol), 0n, 'delegate wSOL starts empty');
    });

    it('Charges a wrapped SOL fee on transfer', async () => {
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
        // Token-2022 resolves the hook's accounts from the list, but the
        // transfer instruction must still carry them: the resolved accounts,
        // then the hook program and the list. Writability has to match too — a
        // CPI cannot widen an account's privileges.
        const transferIx = {
            ...base,
            accounts: [
                ...base.accounts,
                ...feeAccounts(),
                { address: programId, role: AccountRole.READONLY },
                { address: extraAccountMetaList, role: AccountRole.READONLY },
            ],
        };

        const result = send(await tx([transferIx]), 'transfer with hook');

        assert.equal(tokenAmount(sourceTokenAccount), MINTED_AMOUNT - TRANSFER_AMOUNT, 'source debited');
        assert.equal(tokenAmount(destinationTokenAccount), TRANSFER_AMOUNT, 'destination credited');

        // The fee: wSOL equal to the token amount, moved by the delegate.
        assert.equal(tokenAmount(senderWsol), WSOL_FUNDING - TRANSFER_AMOUNT, 'sender charged the fee');
        assert.equal(tokenAmount(delegateWsol), TRANSFER_AMOUNT, 'delegate collected the fee');

        const logs = result.logs().join('\n');
        assert.include(logs, 'This token has been transferred 1 times', 'the hook ran inside the transfer');
        assert.equal(counterValue(), 1n, 'the counter was incremented and persisted');
    });

    it('Charges again on a second transfer', async () => {
        // Byte-identical to the previous transfer, so it needs a new blockhash
        // or it would sign the same and be rejected as already processed.
        svm.expireBlockhash();

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
                ...feeAccounts(),
                { address: programId, role: AccountRole.READONLY },
                { address: extraAccountMetaList, role: AccountRole.READONLY },
            ],
        };

        send(await tx([transferIx]), 'second transfer with hook');

        assert.equal(tokenAmount(delegateWsol), TRANSFER_AMOUNT * 2n, 'delegate collected a second fee');
        assert.equal(counterValue(), 2n, 'the counter advanced to two');
    });

    it('Configures a second mint against the existing counter', async () => {
        // The counter is global, not per-mint, so setting up a second mint must
        // reuse it. Creating it again would fail and roll the whole setup back,
        // leaving every mint after the first unable to use this hook.
        const secondMint = await generateKeyPairSigner();
        const initIx = {
            programAddress: programId,
            accounts: [
                { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
                { address: secondMint.address, role: AccountRole.WRITABLE_SIGNER, signer: secondMint },
                { address: TOKEN_2022_PROGRAM_ADDRESS, role: AccountRole.READONLY },
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ],
            data: Uint8Array.of(INITIALIZE_DISCRIMINATOR, DECIMALS),
        };
        send(await tx([initIx]), 'initialize second mint');

        const [secondMetaList] = await getProgramDerivedAddress({
            programAddress: programId,
            seeds: ['extra-account-metas', addressEncoder.encode(secondMint.address)],
        });
        const countBefore = counterValue();

        const metasIx = {
            programAddress: programId,
            accounts: [
                { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
                { address: secondMetaList, role: AccountRole.WRITABLE },
                { address: secondMint.address, role: AccountRole.READONLY },
                { address: counter, role: AccountRole.WRITABLE },
                { address: TOKEN_2022_PROGRAM_ADDRESS, role: AccountRole.READONLY },
                { address: ASSOCIATED_TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ],
            data: INITIALIZE_EXTRA_ACCOUNT_META_LIST_DISCRIMINATOR,
        };
        send(await tx([metasIx]), 'initialize second extra account meta list');

        const account = svm.getAccount(secondMetaList);
        if (!account?.exists) throw new Error('second extra account meta list not found');
        assert.deepEqual(
            Array.from(account.data),
            Array.from(expectedExtraAccountMetas()),
            'the second mint got its own list',
        );
        assert.equal(counterValue(), countBefore, 'the shared counter kept its value');
    });

    it('Rejects calling the hook outside a transfer', async () => {
        // Same accounts Token-2022 would pass, but invoked directly. Without
        // this check anyone could drain the approved allowance a fee at a time.
        const ix = {
            programAddress: programId,
            accounts: [
                { address: sourceTokenAccount, role: AccountRole.READONLY },
                { address: mint.address, role: AccountRole.READONLY },
                { address: destinationTokenAccount, role: AccountRole.READONLY },
                { address: payer.address, role: AccountRole.READONLY },
                { address: extraAccountMetaList, role: AccountRole.READONLY },
                ...feeAccounts(),
            ],
            data: concatBytes(EXECUTE_DISCRIMINATOR, u64(TRANSFER_AMOUNT)),
        };

        const before = tokenAmount(delegateWsol);
        const result = svm.sendTransaction(await tx([ix]));
        assert.instanceOf(result, FailedTransactionMetadata, 'expected the direct hook call to be rejected');

        const logs = (result as FailedTransactionMetadata).meta().logs().join('\n');
        assert.include(logs, 'Instruction: Execute', 'the hook was reached');
        assert.include(logs, 'custom program error: 0x0', 'rejected with IsNotCurrentlyTransferring');
        assert.equal(tokenAmount(delegateWsol), before, 'no fee was charged');
    });

    it('Rejects a forged source account claiming to be transferring', async () => {
        // The `transferring` flag is only trustworthy because Token-2022 wrote
        // it. Hand-build an account carrying the right bytes at the right
        // offsets but owned by someone else.
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
                ...feeAccounts(),
            ],
            data: concatBytes(EXECUTE_DISCRIMINATOR, u64(TRANSFER_AMOUNT)),
        };

        const before = tokenAmount(delegateWsol);
        const result = svm.sendTransaction(await tx([ix]));
        assert.instanceOf(result, FailedTransactionMetadata, 'expected the forged source account to be rejected');

        const logs = (result as FailedTransactionMetadata).meta().logs().join('\n');
        assert.include(logs, 'custom program error: 0x3', 'rejected with InvalidSourceAccount');
        assert.equal(tokenAmount(delegateWsol), before, 'no fee was charged');
    });

    it('Rejects a substituted fee destination', async () => {
        // The hook rederives every fee account it was handed. Swapping the
        // delegate's wSOL account for one an attacker controls must not work,
        // even mid-transfer with everything else genuine.
        const thief = await generateKeyPairSigner();
        const [thiefWsol] = await findAssociatedTokenPda({
            owner: thief.address,
            mint: NATIVE_MINT,
            tokenProgram: TOKEN_PROGRAM_ADDRESS,
        });
        send(
            await tx([
                getCreateAssociatedTokenInstruction({
                    payer,
                    ata: thiefWsol,
                    owner: thief.address,
                    mint: NATIVE_MINT,
                    tokenProgram: TOKEN_PROGRAM_ADDRESS,
                }),
            ]),
            "create the thief's wSOL account",
        );

        const accounts = feeAccounts();
        accounts[4] = { address: thiefWsol, role: AccountRole.WRITABLE };

        const ix = {
            programAddress: programId,
            accounts: [
                { address: sourceTokenAccount, role: AccountRole.READONLY },
                { address: mint.address, role: AccountRole.READONLY },
                { address: destinationTokenAccount, role: AccountRole.READONLY },
                { address: payer.address, role: AccountRole.READONLY },
                { address: extraAccountMetaList, role: AccountRole.READONLY },
                ...accounts,
            ],
            data: concatBytes(EXECUTE_DISCRIMINATOR, u64(TRANSFER_AMOUNT)),
        };

        // Put the source account mid-transfer so the call gets past the
        // transferring check and reaches the fee accounts.
        rewriteAccount(sourceTokenAccount, data => {
            data[tlvValueOffset(data, 15)] = 1;
        });

        const result = svm.sendTransaction(await tx([ix]));
        assert.instanceOf(result, FailedTransactionMetadata, 'expected the substituted account to be rejected');

        const logs = (result as FailedTransactionMetadata).meta().logs().join('\n');
        assert.include(logs, 'custom program error: 0x6', 'rejected with UnexpectedFeeAccount');
        assert.equal(tokenAmount(thiefWsol), 0n, 'the thief collected nothing');

        rewriteAccount(sourceTokenAccount, data => {
            data[tlvValueOffset(data, 15)] = 0;
        });
    });

    it('Rejects a mint configured with a different hook program', async () => {
        // A mint whose hook is some *other* program is mid-transfer too while
        // that program runs, and that program can CPI here with the genuine
        // source account. Only the mint's own TransferHook config separates the
        // two cases — and here it separates who gets charged a fee.
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
                ...feeAccounts(),
            ],
            data: concatBytes(EXECUTE_DISCRIMINATOR, u64(TRANSFER_AMOUNT)),
        };

        const before = tokenAmount(delegateWsol);
        const result = svm.sendTransaction(await tx([ix]));
        assert.instanceOf(result, FailedTransactionMetadata, 'expected a foreign hook mint to be rejected');

        const logs = (result as FailedTransactionMetadata).meta().logs().join('\n');
        assert.include(logs, 'custom program error: 0x2', 'rejected with UnexpectedTransferHookConfig');
        assert.equal(tokenAmount(delegateWsol), before, 'no fee was charged');
    });
});
