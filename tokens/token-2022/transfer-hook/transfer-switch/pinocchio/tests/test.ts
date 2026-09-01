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
    TOKEN_2022_PROGRAM_ADDRESS,
    findAssociatedTokenPda,
    getApproveInstruction,
    getCreateAssociatedTokenInstruction,
    getMintDecoder,
    getMintToInstruction,
    getTokenDecoder,
    getTransferCheckedInstruction,
} from '@solana-program/token-2022';
import { assert } from 'chai';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';

// A Token-2022 mint carrying the TransferHook extension:
//   base mint (82) padded to 165 + account-type byte (1) + TLV (2 + 2 + 64) = 234
const MINT_SIZE_WITH_TRANSFER_HOOK = 234;

// The serialized ExtraAccountMetaList the program writes: the 8-byte Execute
// discriminator, a u32 value length of 39 (4 + one 35-byte meta), a u32 account
// count of 1, then the meta — a PDA of this program (tag 1) whose seed config
// is AccountData (tag 4) reading 32 bytes at offset 32 of account 0, i.e. the
// source token account's owner. Read-only.
// prettier-ignore
const EXPECTED_EXTRA_ACCOUNT_METAS = Uint8Array.from([
    105, 37, 101, 197, 75, 251, 102, 26, // Execute discriminator
    39, 0, 0, 0,                         // value length (u32) = 4 + 1 * 35
    1, 0, 0, 0,                          // account count (u32) = 1
    1,                                   // address is a PDA of this program
    4, 0, 32, 32,                        // seed config: AccountData(account 0, offset 32, len 32)
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // padding to 32
    0,                                   // is_signer   = false
    0,                                   // is_writable = false
]);

// spl-transfer-hook-interface discriminators: sha256("spl-transfer-hook-interface:<ix>")[0..8].
const EXECUTE_DISCRIMINATOR = Uint8Array.from([105, 37, 101, 197, 75, 251, 102, 26]);
const INITIALIZE_EXTRA_ACCOUNT_META_LIST_DISCRIMINATOR = Uint8Array.from([43, 34, 13, 49, 167, 88, 235, 235]);

// This example's own instructions, which are not part of the interface.
const INITIALIZE_DISCRIMINATOR = 0;
const CONFIGURE_ADMIN_DISCRIMINATOR = 1;
const SWITCH_DISCRIMINATOR = 2;

const DECIMALS = 2;
const MINTED_AMOUNT = 100n * 100n; // 100 tokens
const TRANSFER_AMOUNT = 1n * 100n; // 1 token

const PROGRAM_SO = path.join(
    process.cwd(),
    'tests',
    'fixtures',
    'token_2022_transfer_hook_transfer_switch_pinocchio_program.so',
);
const addressEncoder = getAddressEncoder();

function u64(n: bigint): Uint8Array {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setBigUint64(0, n, true);
    return b;
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

describe('Token-2022 Transfer Hook — Transfer Switch (Pinocchio)', () => {
    let svm: LiteSVM;
    let programId: Address;
    let payer: KeyPairSigner;
    let admin: KeyPairSigner;
    let mint: KeyPairSigner;
    let extraAccountMetaList: Address;
    let adminConfig: Address;
    let payerSwitch: Address;
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
        admin = await generateKeyPairSigner();
        svm.airdrop(payer.address, lamports(10_000_000_000n));
        svm.airdrop(admin.address, lamports(10_000_000_000n));

        mint = await generateKeyPairSigner();
        recipient = await generateKeyPairSigner();

        [extraAccountMetaList] = await getProgramDerivedAddress({
            programAddress: programId,
            seeds: ['extra-account-metas', addressEncoder.encode(mint.address)],
        });
        [adminConfig] = await getProgramDerivedAddress({
            programAddress: programId,
            seeds: ['admin-config'],
        });
        // The switch is keyed by the wallet alone — here the payer, who owns
        // the source token account Token-2022 reads the owner out of.
        [payerSwitch] = await getProgramDerivedAddress({
            programAddress: programId,
            seeds: [addressEncoder.encode(payer.address)],
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

    async function tx(
        instructions: Parameters<typeof appendTransactionMessageInstruction>[0][],
        feePayer: KeyPairSigner = payer,
    ) {
        return signTransactionMessageWithSigners(
            pipe(
                createTransactionMessage({ version: 0 }),
                m => setTransactionMessageFeePayerSigner(feePayer, m),
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

    function switchIsOn(): boolean {
        const account = svm.getAccount(payerSwitch);
        if (!account?.exists) return false;
        return account.data[32] === 1;
    }

    function configureAdminIx(current: KeyPairSigner, newAdmin: Address) {
        return {
            programAddress: programId,
            accounts: [
                { address: current.address, role: AccountRole.WRITABLE_SIGNER, signer: current },
                { address: newAdmin, role: AccountRole.READONLY },
                { address: adminConfig, role: AccountRole.WRITABLE },
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ],
            data: Uint8Array.of(CONFIGURE_ADMIN_DISCRIMINATOR),
        };
    }

    function switchIx(signer: KeyPairSigner, wallet: Address, walletSwitch: Address, on: boolean) {
        return {
            programAddress: programId,
            accounts: [
                { address: signer.address, role: AccountRole.WRITABLE_SIGNER, signer },
                { address: wallet, role: AccountRole.READONLY },
                { address: adminConfig, role: AccountRole.READONLY },
                { address: walletSwitch, role: AccountRole.WRITABLE },
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ],
            data: Uint8Array.of(SWITCH_DISCRIMINATOR, on ? 1 : 0),
        };
    }

    function transferIx() {
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
        // Token-2022 resolves the switch from the list, but the transfer
        // instruction must still carry it, along with the hook program and the
        // list itself.
        return {
            ...base,
            accounts: [
                ...base.accounts,
                { address: payerSwitch, role: AccountRole.READONLY },
                { address: programId, role: AccountRole.READONLY },
                { address: extraAccountMetaList, role: AccountRole.READONLY },
            ],
        };
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
        assert.equal(account.data.length, MINT_SIZE_WITH_TRANSFER_HOOK, 'mint is sized for the TransferHook extension');

        const state = getMintDecoder().decode(account.data);
        const extensions = unwrapOption(state.extensions) ?? [];
        const transferHook = extensions.find(e => e.__kind === 'TransferHook');
        if (transferHook?.__kind !== 'TransferHook') {
            throw new Error('TransferHook extension not found on the mint');
        }
        assert.equal(transferHook.programId, programId, 'the mint points at this program as its hook');
    });

    it('Creates the ExtraAccountMetaList account', async () => {
        // Every PDA this program creates has a publicly derivable address, and
        // `CreateAccount` refuses to create over an account that already holds
        // lamports. A stray lamport would otherwise block setup — or, on the
        // admin config and a wallet's switch, block the program permanently.
        // Drop one on each of the three first.
        for (const address of [extraAccountMetaList, adminConfig, payerSwitch]) {
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
            Array.from(EXPECTED_EXTRA_ACCOUNT_METAS),
            "the list resolves the switch from the source account's owner",
        );
    });

    it('Installs the first admin', async () => {
        // The first call is unchallenged: whoever configures the program first
        // becomes its admin.
        send(await tx([configureAdminIx(payer, admin.address)]), 'configure admin');

        const account = svm.getAccount(adminConfig);
        if (!account?.exists) throw new Error('admin config not found');
        assert.equal(account.programAddress, programId, 'the config is owned by the hook program');
        assert.deepEqual(
            Array.from(account.data),
            Array.from(addressEncoder.encode(admin.address)),
            'the admin was recorded',
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

    it('Blocks a transfer for a wallet that was never switched on', async () => {
        // Default-deny: the switch account does not exist yet, which the hook
        // treats as off rather than as a missing account it can ignore.
        assert.isFalse(switchIsOn(), 'no switch yet');

        const result = svm.sendTransaction(await tx([transferIx()]));
        assert.instanceOf(result, FailedTransactionMetadata, 'expected the transfer to be blocked');

        const logs = (result as FailedTransactionMetadata).meta().logs().join('\n');
        assert.include(logs, 'custom program error: 0x4', 'rejected with SwitchNotOn');
        assert.equal(tokenAmount(destinationTokenAccount), 0n, 'nothing moved');
    });

    it('Rejects a non-admin flipping a switch', async () => {
        const impostor = await generateKeyPairSigner();
        svm.airdrop(impostor.address, lamports(1_000_000_000n));

        const result = svm.sendTransaction(await tx([switchIx(impostor, payer.address, payerSwitch, true)], impostor));
        assert.instanceOf(result, FailedTransactionMetadata, 'expected the switch to be refused');

        const logs = (result as FailedTransactionMetadata).meta().logs().join('\n');
        assert.include(logs, 'custom program error: 0x5', 'rejected with NotAdmin');
        assert.isFalse(switchIsOn(), 'the switch stayed off');
    });

    it('Allows the transfer once the admin switches it on', async () => {
        send(await tx([switchIx(admin, payer.address, payerSwitch, true)], admin), 'switch on');
        assert.isTrue(switchIsOn(), 'the switch is on');

        // This transfer is byte-identical to the one blocked above, and LiteSVM
        // records failed transactions too, so it needs a fresh blockhash or it
        // is rejected as already processed.
        svm.expireBlockhash();
        const result = send(await tx([transferIx()]), 'transfer with hook');

        assert.equal(tokenAmount(sourceTokenAccount), MINTED_AMOUNT - TRANSFER_AMOUNT, 'source debited');
        assert.equal(tokenAmount(destinationTokenAccount), TRANSFER_AMOUNT, 'destination credited');
        assert.include(result.logs().join('\n'), 'Transfer allowed', 'the hook ran inside the transfer');
    });

    it('Blocks the transfer again once the admin switches it off', async () => {
        send(await tx([switchIx(admin, payer.address, payerSwitch, false)], admin), 'switch off');
        assert.isFalse(switchIsOn(), 'the switch is off');

        svm.expireBlockhash();
        const result = svm.sendTransaction(await tx([transferIx()]));
        assert.instanceOf(result, FailedTransactionMetadata, 'expected the transfer to be blocked');

        const logs = (result as FailedTransactionMetadata).meta().logs().join('\n');
        assert.include(logs, 'custom program error: 0x4', 'rejected with SwitchNotOn');
        assert.equal(tokenAmount(destinationTokenAccount), TRANSFER_AMOUNT, 'nothing further moved');
    });

    it('Hands the admin role over, and the old admin loses it', async () => {
        const newAdmin = await generateKeyPairSigner();
        svm.airdrop(newAdmin.address, lamports(1_000_000_000n));

        send(await tx([configureAdminIx(admin, newAdmin.address)], admin), 'hand over admin');

        const account = svm.getAccount(adminConfig);
        if (!account?.exists) throw new Error('admin config not found');
        assert.deepEqual(
            Array.from(account.data),
            Array.from(addressEncoder.encode(newAdmin.address)),
            'the new admin was recorded',
        );

        // The previous admin can no longer flip switches.
        const result = svm.sendTransaction(await tx([switchIx(admin, payer.address, payerSwitch, true)], admin));
        assert.instanceOf(result, FailedTransactionMetadata, 'expected the old admin to be refused');
        assert.include(
            (result as FailedTransactionMetadata).meta().logs().join('\n'),
            'custom program error: 0x5',
            'rejected with NotAdmin',
        );

        // Hand it back so later tests keep a known admin.
        send(await tx([configureAdminIx(newAdmin, admin.address)], newAdmin), 'hand admin back');
    });

    it('Blocks a delegate from moving tokens out of a switched-off wallet', async () => {
        // The transfer authority at index 3 may be a delegate rather than the
        // token owner. If the switch were keyed on that authority, an enabled
        // delegate could drain a wallet the admin had switched off — so the
        // switch is keyed on the source account's owner instead.
        const delegate = await generateKeyPairSigner();
        svm.airdrop(delegate.address, lamports(1_000_000_000n));
        const [delegateSwitch] = await getProgramDerivedAddress({
            programAddress: programId,
            seeds: [addressEncoder.encode(delegate.address)],
        });

        // The delegate is allowed to transfer, and its own switch is on.
        send(
            await tx([
                getApproveInstruction(
                    { source: sourceTokenAccount, delegate: delegate.address, owner: payer, amount: MINTED_AMOUNT },
                    { programAddress: TOKEN_2022_PROGRAM_ADDRESS },
                ),
            ]),
            'approve the delegate',
        );
        send(await tx([switchIx(admin, delegate.address, delegateSwitch, true)], admin), 'switch the delegate on');

        // The owner is switched off.
        send(await tx([switchIx(admin, payer.address, payerSwitch, false)], admin), 'switch the owner off');
        assert.isFalse(switchIsOn(), "the owner's switch is off");

        const base = getTransferCheckedInstruction(
            {
                source: sourceTokenAccount,
                mint: mint.address,
                destination: destinationTokenAccount,
                authority: delegate,
                amount: TRANSFER_AMOUNT,
                decimals: DECIMALS,
            },
            { programAddress: TOKEN_2022_PROGRAM_ADDRESS },
        );
        // Token-2022 resolves the owner's switch, not the delegate's.
        const delegatedTransferIx = {
            ...base,
            accounts: [
                ...base.accounts,
                { address: payerSwitch, role: AccountRole.READONLY },
                { address: programId, role: AccountRole.READONLY },
                { address: extraAccountMetaList, role: AccountRole.READONLY },
            ],
        };

        const before = tokenAmount(destinationTokenAccount);
        const result = svm.sendTransaction(await tx([delegatedTransferIx]));
        assert.instanceOf(result, FailedTransactionMetadata, 'expected the delegated transfer to be blocked');

        const logs = (result as FailedTransactionMetadata).meta().logs().join('\n');
        assert.include(logs, 'custom program error: 0x4', 'rejected with SwitchNotOn');
        assert.equal(tokenAmount(destinationTokenAccount), before, 'nothing moved');
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
                { address: payerSwitch, role: AccountRole.READONLY },
            ],
            data: concatBytes(EXECUTE_DISCRIMINATOR, u64(TRANSFER_AMOUNT)),
        };

        const result = svm.sendTransaction(await tx([ix]));
        assert.instanceOf(result, FailedTransactionMetadata, 'expected the direct hook call to be rejected');

        const logs = (result as FailedTransactionMetadata).meta().logs().join('\n');
        assert.include(logs, 'Instruction: Execute', 'the hook was reached');
        assert.include(logs, 'custom program error: 0x0', 'rejected with IsNotCurrentlyTransferring');
        assert.notInclude(logs, 'Transfer allowed', 'the hook body did not run');
    });

    it('Rejects a substituted switch account', async () => {
        // Someone else's switch, turned on, must not authorise this wallet.
        const other = await generateKeyPairSigner();
        const [otherSwitch] = await getProgramDerivedAddress({
            programAddress: programId,
            seeds: [addressEncoder.encode(other.address)],
        });
        send(await tx([switchIx(admin, other.address, otherSwitch, true)], admin), 'switch the other wallet on');

        const ix = {
            programAddress: programId,
            accounts: [
                { address: sourceTokenAccount, role: AccountRole.READONLY },
                { address: mint.address, role: AccountRole.READONLY },
                { address: destinationTokenAccount, role: AccountRole.READONLY },
                { address: payer.address, role: AccountRole.READONLY },
                { address: extraAccountMetaList, role: AccountRole.READONLY },
                { address: otherSwitch, role: AccountRole.READONLY },
            ],
            data: concatBytes(EXECUTE_DISCRIMINATOR, u64(TRANSFER_AMOUNT)),
        };

        // Put the source account mid-transfer so the call reaches the switch check.
        rewriteAccount(sourceTokenAccount, data => {
            data[tlvValueOffset(data, 15)] = 1;
        });

        const result = svm.sendTransaction(await tx([ix]));
        assert.instanceOf(result, FailedTransactionMetadata, 'expected the substituted switch to be rejected');

        const logs = (result as FailedTransactionMetadata).meta().logs().join('\n');
        assert.include(logs, 'custom program error: 0x7', 'rejected with InvalidSwitchAccount');
        assert.notInclude(logs, 'Transfer allowed', 'the hook body did not run');

        rewriteAccount(sourceTokenAccount, data => {
            data[tlvValueOffset(data, 15)] = 0;
        });
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
                { address: payerSwitch, role: AccountRole.READONLY },
            ],
            data: concatBytes(EXECUTE_DISCRIMINATOR, u64(TRANSFER_AMOUNT)),
        };

        const result = svm.sendTransaction(await tx([ix]));
        assert.instanceOf(result, FailedTransactionMetadata, 'expected the forged source account to be rejected');

        const logs = (result as FailedTransactionMetadata).meta().logs().join('\n');
        assert.include(logs, 'custom program error: 0x3', 'rejected with InvalidSourceAccount');
        assert.notInclude(logs, 'Transfer allowed', 'the hook body did not run');
    });

    it('Rejects a mint configured with a different hook program', async () => {
        // A mint whose hook is some *other* program is mid-transfer too while
        // that program runs, and that program can CPI here with the genuine
        // source account. Only the mint's own TransferHook config separates the
        // two cases.
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
                { address: payerSwitch, role: AccountRole.READONLY },
            ],
            data: concatBytes(EXECUTE_DISCRIMINATOR, u64(TRANSFER_AMOUNT)),
        };

        const result = svm.sendTransaction(await tx([ix]));
        assert.instanceOf(result, FailedTransactionMetadata, 'expected a foreign hook mint to be rejected');

        const logs = (result as FailedTransactionMetadata).meta().logs().join('\n');
        assert.include(logs, 'custom program error: 0x2', 'rejected with UnexpectedTransferHookConfig');
        assert.notInclude(logs, 'Transfer allowed', 'the hook body did not run');
    });
});
