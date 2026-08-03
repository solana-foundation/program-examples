import { Buffer } from 'node:buffer';
import {
    AccountRole,
    type Address,
    appendTransactionMessageInstruction,
    createTransactionMessage,
    generateKeyPairSigner,
    type KeyPairSigner,
    lamports,
    pipe,
    setTransactionMessageFeePayerSigner,
    signTransactionMessageWithSigners,
} from '@solana/kit';
import { assert } from 'chai';
import { FailedTransactionMetadata, LiteSVM, TransactionMetadata } from 'litesvm';

// Big-endian BLS12-381 G2 keys and their running aggregates, taken from the
// crypto-primitives reference implementation.
const PUBKEY_1 =
    '13e02b6052719f607dacd3a088274f65596bd0d09920b61ab5da61bbdc7f5049334cf11213945d57e5ac7d055d042b7e024aa2b2f08f0a91260805272dc51051c6e47ad4fa403b02b4510b647ae3d1770bac0326a805bbefd48056c8c121bdb80606c4a02ea734cc32acd2b02bc28b99cb3e287e85a763af267492ab572e99ab3f370d275cec1da1aaa9075ff05f79be0ce5d527727d6e118cc9cdc6da2e351aadfd9baa8cbdd3a76d429a695160d12c923ac9cc3baca289e193548608b82801';
const PUBKEY_2 =
    '0a4edef9c1ed7f729f520e47730a124fd70662a904ba1074728114d1031e1572c6c886f6b57ec72a6178288c47c335771638533957d540a9d2370f17cc7ed5863bc0b995b8825e0ee1ea1e1e4d00dbae81f14b0bf3611b78c952aacab827a0530f6d4552fa65dd2638b361543f887136a43253d9c66c411697003f7a13c308f5422e1aa0a59c8967acdefd8b6e36ccf30468fb440d82b0630aeb8dca2b5256789a66da69bf91009cbfe6bd221e47aa8ae88dece9764bf3bd999d95d71e4c9899';
const PUBKEY_3 =
    '09380275bbc8e5dcea7dc4dd7e0550ff2ac480905396eda55062650f8d251c96eb480673937cc6d9d6a44aaa56ca66dc122915c824a0857e2ee414a3dccb23ae691ae54329781315a0c75df1c04d6d7a50a030fc866f09d516020ef82324afae08f239ba329b3967fe48d718a36cfe5f62a7e42e0bf1c1ed714150a166bfbd6bcf6b3b58b975b9edea56d53f23a0e8490b21da7955969e61010c7a1abc1a6f0136961d1e3b20b1a7326ac738fef5c721479dfd948b52fdf2455e44813ecfd892';
const AGG_1_2 = PUBKEY_3;
const AGG_1_2_3 =
    '03f4b4e761936d90fd5f55f99087138a07a69755ad4a46e4dd1c2cfe6d11371e1cc033111a0595e3bba98d0f538db45119e384121b7d70927c49e6d044fd8517c36bc6ed2813a8956dd64f049869e8a77f7e46930240e6984abe26fa6a89658f088bb5832f4a4a452edda646ebaa2853a54205d56329960b44b2450070734724a74daaa401879bad142132316e9b340117a31a4fccfb5f768a2157517c77a4f8aaf0dee8f260d96e02e1175a8754d09600923beae02a019afc327b65a2fdbbfc';
const AGG_1_3 =
    '070227d3f13684fdb7ce31b8065ba3acb35f7bde6fe2ddfefa359f8b35d08a9ab9537b43e24f4ffb720b5a0bda2a82f20e7a30979a8853a077454eb63b8dcee75f106221b262886bb8e01b0abb043368da82f60899cc1412e33e4120195fc5570782c14e2c4ee61cbe7be6e462a66b2e3509f42d53ff333efc9bfe9a00307cd2f68b007606446d98a75fb808a405d8b90701377cb7da22789d032737eabcea2b2eee6bb4634c4365864511a43c2caad50422993ccd3e99636eb8a5f189454b18';

const IX_ADD = 0;
const IX_REMOVE = 1;

const G2_POINT = 192;
const COUNT_PREFIX = 2;

const ERR_INVALID_REGISTRY_ACCOUNT = 'InstructionErrorCustom { code: 3 }';
const ERR_REGISTRY_EMPTY = 'InstructionErrorCustom { code: 4 }';

const hex = (s: string) => Uint8Array.from(Buffer.from(s, 'hex'));

const registryData = (count: number, aggregate?: string) => {
    const data = new Uint8Array(COUNT_PREFIX + G2_POINT);
    new DataView(data.buffer).setUint16(0, count, true);
    if (aggregate) data.set(hex(aggregate), COUNT_PREFIX);
    return data;
};

describe('bls-key-registry', () => {
    const svm = new LiteSVM();
    let programId: Address;
    let payer: KeyPairSigner;

    before(async () => {
        programId = (await generateKeyPairSigner()).address;
        svm.addProgramFromFile(programId, 'tests/fixtures/bls_key_registry_pinocchio_program.so');

        payer = await generateKeyPairSigner();
        svm.airdrop(payer.address, lamports(1_000_000_000n));
    });

    async function registryAccount(owner: Address, count: number, aggregate?: string) {
        const address = (await generateKeyPairSigner()).address;
        const data = registryData(count, aggregate);
        svm.setAccount({
            address,
            data,
            executable: false,
            lamports: lamports(1_000_000_000n),
            programAddress: owner,
            space: BigInt(data.length),
        });
        return address;
    }

    async function send(discriminator: number, pubkey: string, registry: Address) {
        const data = new Uint8Array([discriminator, ...hex(pubkey)]);
        const transactionMessage = pipe(
            createTransactionMessage({ version: 0 }),
            m => setTransactionMessageFeePayerSigner(payer, m),
            m => svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
            m =>
                appendTransactionMessageInstruction(
                    { programAddress: programId, accounts: [{ address: registry, role: AccountRole.WRITABLE }], data },
                    m,
                ),
        );
        const signedTx = await signTransactionMessageWithSigners(transactionMessage);

        const result = svm.sendTransaction(signedTx);
        svm.expireBlockhash();
        return result;
    }

    function expectRegistry(registry: Address, count: number, aggregate?: string) {
        const account = svm.getAccount(registry);
        assert(account?.exists, 'expected the registry account to exist');
        assert.deepEqual(account.data, registryData(count, aggregate));
    }

    it('first member is stored verbatim', async () => {
        const registry = await registryAccount(programId, 0);
        const result = await send(IX_ADD, PUBKEY_1, registry);

        assert(result instanceof TransactionMetadata, `transaction failed: ${result.toString()}`);
        expectRegistry(registry, 1, PUBKEY_1);
    });

    it('members fold into a running aggregate key', async () => {
        const registry = await registryAccount(programId, 0);
        await send(IX_ADD, PUBKEY_1, registry);
        await send(IX_ADD, PUBKEY_2, registry);
        expectRegistry(registry, 2, AGG_1_2);

        await send(IX_ADD, PUBKEY_3, registry);
        expectRegistry(registry, 3, AGG_1_2_3);
    });

    it('remove subtracts the member from the aggregate', async () => {
        const registry = await registryAccount(programId, 3, AGG_1_2_3);
        const result = await send(IX_REMOVE, PUBKEY_2, registry);

        assert(result instanceof TransactionMetadata, `transaction failed: ${result.toString()}`);
        expectRegistry(registry, 2, AGG_1_3);
    });

    it('removing the last member zeroes the aggregate', async () => {
        const registry = await registryAccount(programId, 1, PUBKEY_1);
        await send(IX_REMOVE, PUBKEY_1, registry);
        expectRegistry(registry, 0);
    });

    it('removing from an empty registry is rejected', async () => {
        const registry = await registryAccount(programId, 0);
        const result = await send(IX_REMOVE, PUBKEY_1, registry);

        assert(result instanceof FailedTransactionMetadata, 'expected the transaction to fail');
        assert.include(String(result.err()), ERR_REGISTRY_EMPTY);
    });

    it('rejects an account not owned by the program', async () => {
        const foreignOwner = (await generateKeyPairSigner()).address;
        const registry = await registryAccount(foreignOwner, 0);
        const result = await send(IX_ADD, PUBKEY_1, registry);

        assert(result instanceof FailedTransactionMetadata, 'expected the transaction to fail');
        assert.include(String(result.err()), ERR_INVALID_REGISTRY_ACCOUNT);
    });
});
