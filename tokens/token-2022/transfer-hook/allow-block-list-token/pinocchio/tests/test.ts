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
    findAssociatedTokenPda,
    getCreateAssociatedTokenInstruction,
    getMintDecoder,
    getMintToInstruction,
    getTokenDecoder,
    getTransferCheckedInstruction,
} from '@solana-program/token-2022';
import { assert } from 'chai';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';

const INIT_CONFIG = 0;
const INIT_MINT = 1;
const ATTACH_TO_MINT = 2;
const INIT_WALLET = 3;
const REMOVE_WALLET = 4;
const CHANGE_MODE = 5;
const RESIZE_META_LIST = 6;

const MODE_ALLOW = 0;
const MODE_BLOCK = 1;
const MODE_MIXED = 2;

// The serialized ExtraAccountMetaList the program writes: the Execute
// discriminator, a u32 value length of 74 (4 + two 35-byte metas), a count of
// 2, then one meta per side of the transfer. Each is a PDA of this program
// seeded by Literal("ab_wallet") and AccountData reading 32 bytes at offset 32
// of the source (index 0) and destination (index 2) token accounts.
// prettier-ignore
const EXPECTED_EXTRA_ACCOUNT_METAS = Uint8Array.from([
    105, 37, 101, 197, 75, 251, 102, 26,
    74, 0, 0, 0,
    2, 0, 0, 0,
    1,
    1, 9, 97, 98, 95, 119, 97, 108, 108, 101, 116,
    4, 0, 32, 32,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0,
    0,
    1,
    1, 9, 97, 98, 95, 119, 97, 108, 108, 101, 116,
    4, 2, 32, 32,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0,
    0,
]);

const DECIMALS = 2;
const MINTED = 10_000n;
const SMALL = 10n;
const LARGE = 5_000n;
const THRESHOLD = 1_000n;

const PROGRAM_SO = path.join(process.cwd(), 'tests', 'fixtures', 'token_2022_abl_token_pinocchio_program.so');
const addressEncoder = getAddressEncoder();

function u64(n: bigint): Uint8Array {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setBigUint64(0, n, true);
    return b;
}
function str(value: string): Uint8Array {
    const bytes = new TextEncoder().encode(value);
    return concatBytes(Uint8Array.of(bytes.length), bytes);
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

describe('Token-2022 Transfer Hook — Allow/Block List Token (Pinocchio)', () => {
    let svm: LiteSVM;
    let programId: Address;
    let payer: KeyPairSigner;
    let mint: KeyPairSigner;
    let config: Address;
    let metaList: Address;
    let alice: KeyPairSigner;
    let bob: KeyPairSigner;
    let aliceAta: Address;
    let bobAta: Address;

    before(async () => {
        svm = new LiteSVM();
        // The program derives every PDA from the id it is invoked with, so a
        // generated id keeps the test self-contained.
        programId = (await generateKeyPairSigner()).address;
        svm.addProgramFromFile(programId, PROGRAM_SO);

        payer = await generateKeyPairSigner();
        alice = await generateKeyPairSigner();
        bob = await generateKeyPairSigner();
        for (const signer of [payer, alice, bob]) {
            svm.airdrop(signer.address, lamports(10_000_000_000n));
        }

        mint = await generateKeyPairSigner();

        [config] = await getProgramDerivedAddress({ programAddress: programId, seeds: ['config'] });
        [metaList] = await getProgramDerivedAddress({
            programAddress: programId,
            seeds: ['extra-account-metas', addressEncoder.encode(mint.address)],
        });
        [aliceAta] = await findAssociatedTokenPda({
            owner: alice.address,
            mint: mint.address,
            tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
        });
        [bobAta] = await findAssociatedTokenPda({
            owner: bob.address,
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

    function tokenAmount(account: Address): bigint {
        const acc = svm.getAccount(account);
        if (!acc?.exists) throw new Error('token account not found');
        return getTokenDecoder().decode(acc.data).amount;
    }

    async function abWallet(wallet: Address): Promise<Address> {
        const [address] = await getProgramDerivedAddress({
            programAddress: programId,
            seeds: ['ab_wallet', addressEncoder.encode(wallet)],
        });
        return address;
    }

    async function listWalletIx(wallet: Address, allowed: boolean) {
        return {
            programAddress: programId,
            accounts: [
                { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
                { address: config, role: AccountRole.READONLY },
                { address: wallet, role: AccountRole.READONLY },
                { address: await abWallet(wallet), role: AccountRole.WRITABLE },
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ],
            data: Uint8Array.of(INIT_WALLET, allowed ? 1 : 0),
        };
    }

    function changeModeIx(mode: number, threshold: bigint) {
        return {
            programAddress: programId,
            accounts: [
                { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
                { address: mint.address, role: AccountRole.WRITABLE },
                { address: TOKEN_2022_PROGRAM_ADDRESS, role: AccountRole.READONLY },
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ],
            data: concatBytes(Uint8Array.of(CHANGE_MODE, mode), u64(threshold)),
        };
    }

    // Token-2022 resolves both records from the list, but the transfer
    // instruction must still carry them, plus the hook program and the list.
    async function transferIx(from: KeyPairSigner, fromAta: Address, toAta: Address, toOwner: Address, amount: bigint) {
        const base = getTransferCheckedInstruction(
            {
                source: fromAta,
                mint: mint.address,
                destination: toAta,
                authority: from,
                amount,
                decimals: DECIMALS,
            },
            { programAddress: TOKEN_2022_PROGRAM_ADDRESS },
        );
        return {
            ...base,
            accounts: [
                ...base.accounts,
                { address: await abWallet(from.address), role: AccountRole.READONLY },
                { address: await abWallet(toOwner), role: AccountRole.READONLY },
                { address: programId, role: AccountRole.READONLY },
                { address: metaList, role: AccountRole.READONLY },
            ],
        };
    }

    function expectFailure(result: unknown, code: string, label: string) {
        assert.instanceOf(result, FailedTransactionMetadata, `expected ${label} to be rejected`);
        assert.include(
            (result as FailedTransactionMetadata).meta().logs().join('\n'),
            `custom program error: ${code}`,
            label,
        );
    }

    it('Creates the config', async () => {
        const ix = {
            programAddress: programId,
            accounts: [
                { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
                { address: config, role: AccountRole.WRITABLE },
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ],
            data: Uint8Array.of(INIT_CONFIG),
        };
        send(await tx([ix]), 'init config');

        const account = svm.getAccount(config);
        if (!account?.exists) throw new Error('config not found');
        assert.equal(account.programAddress, programId, 'the config is owned by the program');
        assert.deepEqual(
            Array.from(account.data.slice(0, 32)),
            Array.from(addressEncoder.encode(payer.address)),
            'the authority was recorded',
        );
    });

    it('Creates a mint gated by this hook, in Allow mode', async () => {
        const ix = {
            programAddress: programId,
            accounts: [
                { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
                { address: mint.address, role: AccountRole.WRITABLE_SIGNER, signer: mint },
                { address: metaList, role: AccountRole.WRITABLE },
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
                { address: TOKEN_2022_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ],
            data: concatBytes(
                Uint8Array.of(INIT_MINT, DECIMALS, MODE_ALLOW),
                u64(0n),
                new Uint8Array(addressEncoder.encode(payer.address)), // permanent delegate
                new Uint8Array(addressEncoder.encode(payer.address)), // transfer hook authority
                str('ABL Token'),
                str('ABL'),
                str('https://example.com/abl.json'),
            ),
        };
        send(await tx([ix]), 'init mint');

        const account = svm.getAccount(mint.address);
        if (!account?.exists) throw new Error('mint not found');
        const state = getMintDecoder().decode(account.data);
        assert.equal(state.decimals, DECIMALS);

        const extensions = unwrapOption(state.extensions) ?? [];
        const hook = extensions.find(e => e.__kind === 'TransferHook');
        if (hook?.__kind !== 'TransferHook') throw new Error('TransferHook extension missing');
        assert.equal(hook.programId, programId, 'the mint points at this program');

        assert.isDefined(
            extensions.find(e => e.__kind === 'PermanentDelegate'),
            'permanent delegate set',
        );
        assert.isDefined(
            extensions.find(e => e.__kind === 'MetadataPointer'),
            'metadata pointer set',
        );

        const metadata = extensions.find(e => e.__kind === 'TokenMetadata');
        if (metadata?.__kind !== 'TokenMetadata') throw new Error('TokenMetadata extension missing');
        assert.equal(metadata.name, 'ABL Token');
        assert.equal(metadata.symbol, 'ABL');
        assert.deepEqual(
            metadata.additionalMetadata.get('AB'),
            'Allow',
            'the mode was written where the Anchor version reads it',
        );

        const list = svm.getAccount(metaList);
        if (!list?.exists) throw new Error('meta list not found');
        assert.deepEqual(
            Array.from(list.data),
            Array.from(EXPECTED_EXTRA_ACCOUNT_METAS),
            'the list resolves both wallets from the token accounts',
        );
    });

    it('Creates token accounts and mints supply', async () => {
        send(
            await tx([
                getCreateAssociatedTokenInstruction({
                    payer,
                    ata: aliceAta,
                    owner: alice.address,
                    mint: mint.address,
                    tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
                }),
                getCreateAssociatedTokenInstruction({
                    payer,
                    ata: bobAta,
                    owner: bob.address,
                    mint: mint.address,
                    tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
                }),
                getMintToInstruction(
                    { mint: mint.address, token: aliceAta, mintAuthority: payer, amount: MINTED },
                    { programAddress: TOKEN_2022_PROGRAM_ADDRESS },
                ),
            ]),
            'create token accounts',
        );

        assert.equal(tokenAmount(aliceAta), MINTED);
    });

    it('Allow mode blocks a transfer to an unlisted wallet', async () => {
        const result = svm.sendTransaction(
            await tx([await transferIx(alice, aliceAta, bobAta, bob.address, SMALL)], alice),
        );
        expectFailure(result, '0x1', 'rejected with WalletNotAllowed');
        assert.equal(tokenAmount(bobAta), 0n, 'nothing moved');
    });

    it('Allow mode permits a transfer once the receiver is listed', async () => {
        send(await tx([await listWalletIx(bob.address, true)]), 'allow bob');
        svm.expireBlockhash();

        send(await tx([await transferIx(alice, aliceAta, bobAta, bob.address, SMALL)], alice), 'transfer to bob');
        assert.equal(tokenAmount(bobAta), SMALL, 'bob was paid');
    });

    it('A blocked sender cannot transfer even to an allowed receiver', async () => {
        // The Anchor version checks both sides; the sender check is the one
        // that is easy to omit, so it gets its own case.
        send(await tx([await listWalletIx(alice.address, false)]), 'block alice');
        svm.expireBlockhash();

        const before = tokenAmount(bobAta);
        const result = svm.sendTransaction(
            await tx([await transferIx(alice, aliceAta, bobAta, bob.address, SMALL)], alice),
        );
        expectFailure(result, '0x0', 'rejected with WalletBlocked');
        assert.equal(tokenAmount(bobAta), before, 'nothing moved');
    });

    it('Delisting a wallet restores it to the default treatment', async () => {
        const record = await abWallet(alice.address);
        const ix = {
            programAddress: programId,
            accounts: [
                { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
                { address: config, role: AccountRole.READONLY },
                { address: alice.address, role: AccountRole.READONLY },
                { address: record, role: AccountRole.WRITABLE },
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ],
            data: Uint8Array.of(REMOVE_WALLET),
        };
        send(await tx([ix]), 'delist alice');

        assert.isNotTrue(svm.getAccount(record)?.exists, 'the record is gone');

        svm.expireBlockhash();
        send(await tx([await transferIx(alice, aliceAta, bobAta, bob.address, SMALL)], alice), 'transfer after delist');
    });

    it('Rejects listing a wallet from a non-authority', async () => {
        const impostor = alice;
        const ix = {
            ...(await listWalletIx(bob.address, false)),
            accounts: [
                { address: impostor.address, role: AccountRole.WRITABLE_SIGNER, signer: impostor },
                { address: config, role: AccountRole.READONLY },
                { address: bob.address, role: AccountRole.READONLY },
                { address: await abWallet(bob.address), role: AccountRole.WRITABLE },
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ],
        };

        const result = svm.sendTransaction(await tx([ix], impostor));
        expectFailure(result, '0x8', 'rejected with NotAuthority');
    });

    it('Block mode lets unlisted wallets transact', async () => {
        send(await tx([changeModeIx(MODE_BLOCK, 0n)]), 'switch to block mode');

        const carol = await generateKeyPairSigner();
        svm.airdrop(carol.address, lamports(1_000_000_000n));
        const [carolAta] = await findAssociatedTokenPda({
            owner: carol.address,
            mint: mint.address,
            tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
        });
        send(
            await tx([
                getCreateAssociatedTokenInstruction({
                    payer,
                    ata: carolAta,
                    owner: carol.address,
                    mint: mint.address,
                    tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
                }),
            ]),
            "create carol's account",
        );

        send(
            await tx([await transferIx(alice, aliceAta, carolAta, carol.address, SMALL)], alice),
            'transfer to an unlisted wallet',
        );
        assert.equal(tokenAmount(carolAta), SMALL, 'carol was paid without being listed');
    });

    it('Mixed mode gates only transfers at or above the threshold', async () => {
        send(await tx([changeModeIx(MODE_MIXED, THRESHOLD)]), 'switch to mixed mode');

        const dave = await generateKeyPairSigner();
        const [daveAta] = await findAssociatedTokenPda({
            owner: dave.address,
            mint: mint.address,
            tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
        });
        send(
            await tx([
                getCreateAssociatedTokenInstruction({
                    payer,
                    ata: daveAta,
                    owner: dave.address,
                    mint: mint.address,
                    tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
                }),
            ]),
            "create dave's account",
        );

        // Below the threshold an unlisted receiver is fine.
        send(await tx([await transferIx(alice, aliceAta, daveAta, dave.address, SMALL)], alice), 'small transfer');
        assert.equal(tokenAmount(daveAta), SMALL, 'the small transfer went through');

        // At or above it, the receiver must be listed.
        svm.expireBlockhash();
        const result = svm.sendTransaction(
            await tx([await transferIx(alice, aliceAta, daveAta, dave.address, LARGE)], alice),
        );
        expectFailure(result, '0x2', 'rejected with AmountNotAllowed');

        // Listing dave lets the large transfer through.
        send(await tx([await listWalletIx(dave.address, true)]), 'allow dave');
        svm.expireBlockhash();
        send(await tx([await transferIx(alice, aliceAta, daveAta, dave.address, LARGE)], alice), 'large transfer');
        assert.equal(tokenAmount(daveAta), SMALL + LARGE, 'the large transfer went through');
    });

    it('Rewrites the meta list permissionlessly', async () => {
        // Deliberately open: the content is fully determined by the mint and
        // this program's fixed list, so a mint whose hook authority was revoked
        // is not stranded. Anyone may call it.
        const stranger = await generateKeyPairSigner();
        svm.airdrop(stranger.address, lamports(1_000_000_000n));

        const ix = {
            programAddress: programId,
            accounts: [
                { address: stranger.address, role: AccountRole.WRITABLE_SIGNER, signer: stranger },
                { address: mint.address, role: AccountRole.READONLY },
                { address: metaList, role: AccountRole.WRITABLE },
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ],
            data: Uint8Array.of(RESIZE_META_LIST),
        };
        send(await tx([ix], stranger), 'resize meta list');

        const list = svm.getAccount(metaList);
        if (!list?.exists) throw new Error('meta list not found');
        assert.deepEqual(Array.from(list.data), Array.from(EXPECTED_EXTRA_ACCOUNT_METAS), 'the list is unchanged');
    });

    it('Rejects rewriting the list for a mint that does not use this hook', async () => {
        const otherMint = await generateKeyPairSigner();
        const [otherList] = await getProgramDerivedAddress({
            programAddress: programId,
            seeds: ['extra-account-metas', addressEncoder.encode(otherMint.address)],
        });

        // A mint with no TransferHook extension at all.
        svm.setAccount({
            address: otherMint.address,
            data: new Uint8Array(82),
            executable: false,
            lamports: lamports(svm.minimumBalanceForRentExemption(82n)),
            programAddress: TOKEN_2022_PROGRAM_ADDRESS,
            space: 82n,
        });

        const ix = {
            programAddress: programId,
            accounts: [
                { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
                { address: otherMint.address, role: AccountRole.READONLY },
                { address: otherList, role: AccountRole.WRITABLE },
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ],
            data: Uint8Array.of(RESIZE_META_LIST),
        };

        const result = svm.sendTransaction(await tx([ix]));
        expectFailure(result, '0x5', 'rejected with MintNotUsingThisHook');
    });

    it('Refuses to attach to a mint carrying no policy', async () => {
        // Attaching would switch the hook on over metadata `Execute` cannot
        // read, and `ChangeMode` can only update metadata that already exists —
        // so a mint with no `TokenMetadata` would be stuck with every transfer
        // failing and no way back. Refusing here makes that unreachable.
        const bareMint = await generateKeyPairSigner();
        const [bareList] = await getProgramDerivedAddress({
            programAddress: programId,
            seeds: ['extra-account-metas', addressEncoder.encode(bareMint.address)],
        });
        svm.setAccount({
            address: bareMint.address,
            data: new Uint8Array(82),
            executable: false,
            lamports: lamports(svm.minimumBalanceForRentExemption(82n)),
            programAddress: TOKEN_2022_PROGRAM_ADDRESS,
            space: 82n,
        });

        const ix = {
            programAddress: programId,
            accounts: [
                { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
                { address: bareMint.address, role: AccountRole.WRITABLE },
                { address: bareList, role: AccountRole.WRITABLE },
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
                { address: TOKEN_2022_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ],
            data: Uint8Array.of(ATTACH_TO_MINT),
        };

        const result = svm.sendTransaction(await tx([ix]));
        expectFailure(result, '0x3', 'rejected with InvalidMetadata');
        assert.isNotTrue(svm.getAccount(bareList)?.exists, 'no meta list was created');
    });

    it('Refuses to attach to a mint whose threshold is malformed', async () => {
        // A valid mode alongside an unparseable threshold bricks the mint just
        // as surely as no metadata at all, since `Execute` parses both. The
        // guard has to cover everything the hook will later read.
        const second = await generateKeyPairSigner();
        const [secondList] = await getProgramDerivedAddress({
            programAddress: programId,
            seeds: ['extra-account-metas', addressEncoder.encode(second.address)],
        });

        const initSecondIx = {
            programAddress: programId,
            accounts: [
                { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
                { address: second.address, role: AccountRole.WRITABLE_SIGNER, signer: second },
                { address: secondList, role: AccountRole.WRITABLE },
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
                { address: TOKEN_2022_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ],
            data: concatBytes(
                Uint8Array.of(INIT_MINT, DECIMALS, MODE_ALLOW),
                u64(0n),
                new Uint8Array(addressEncoder.encode(payer.address)),
                new Uint8Array(addressEncoder.encode(payer.address)),
                str('Second'),
                str('SEC'),
                str('https://example.com/second.json'),
            ),
        };
        send(await tx([initSecondIx]), 'init second mint');

        // Clear the list so `attach_to_mint` has something to create, then put
        // a non-decimal threshold on the mint via a raw UpdateField.
        svm.setAccount({
            address: secondList,
            data: new Uint8Array(0),
            executable: false,
            lamports: lamports(0n),
            programAddress: SYSTEM_PROGRAM_ADDRESS,
            space: 0n,
        });

        const borshString = (value: string) => {
            const bytes = new TextEncoder().encode(value);
            const len = new Uint8Array(4);
            new DataView(len.buffer).setUint32(0, bytes.length, true);
            return concatBytes(len, bytes);
        };
        const badThresholdIx = {
            programAddress: TOKEN_2022_PROGRAM_ADDRESS,
            accounts: [
                { address: second.address, role: AccountRole.WRITABLE },
                { address: payer.address, role: AccountRole.READONLY_SIGNER, signer: payer },
            ],
            data: concatBytes(
                Uint8Array.from([221, 233, 49, 45, 181, 202, 220, 200]), // UpdateField
                Uint8Array.of(3), // Field::Key
                borshString('threshold'),
                borshString('not-a-number'),
            ),
        };
        // The extra key grows the mint, so top its rent up in the same
        // transaction or the write drops it below exemption.
        send(
            await tx([
                getTransferSolInstruction({ source: payer, destination: second.address, amount: lamports(5_000_000n) }),
                badThresholdIx,
            ]),
            'write a malformed threshold',
        );

        const ix = {
            programAddress: programId,
            accounts: [
                { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
                { address: second.address, role: AccountRole.WRITABLE },
                { address: secondList, role: AccountRole.WRITABLE },
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
                { address: TOKEN_2022_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ],
            data: Uint8Array.of(ATTACH_TO_MINT),
        };

        const result = svm.sendTransaction(await tx([ix]));
        expectFailure(result, '0x3', 'rejected with InvalidMetadata');
        assert.isNotTrue(svm.getAccount(secondList)?.exists, 'no meta list was created');
    });

    it('Rejects calling the hook outside a transfer', async () => {
        // Anchor declares every account here unchecked and validates nothing.
        // This port refuses a direct call, so the decision can only be reached
        // through a real transfer.
        const ix = {
            programAddress: programId,
            accounts: [
                { address: aliceAta, role: AccountRole.READONLY },
                { address: mint.address, role: AccountRole.READONLY },
                { address: bobAta, role: AccountRole.READONLY },
                { address: alice.address, role: AccountRole.READONLY },
                { address: metaList, role: AccountRole.READONLY },
                { address: await abWallet(alice.address), role: AccountRole.READONLY },
                { address: await abWallet(bob.address), role: AccountRole.READONLY },
            ],
            data: concatBytes(Uint8Array.from([105, 37, 101, 197, 75, 251, 102, 26]), u64(SMALL)),
        };

        const result = svm.sendTransaction(await tx([ix]));
        expectFailure(result, '0xa', 'rejected with IsNotCurrentlyTransferring');
    });
});
