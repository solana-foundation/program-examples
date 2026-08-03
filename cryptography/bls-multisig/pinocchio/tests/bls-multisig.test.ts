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

// BLS-over-BN254 test vectors (message "approve proposal #42", secrets 1, 2, 3),
// taken from the crypto-primitives reference implementation.
const PUBKEY_1 =
    '198e9393920d483a7260bfb731fb5d25f1aa493335a9e71297e485b7aef312c21800deef121f1e76426a00665e5c4479674322d4f75edadd46debd5cd992f6ed090689d0585ff075ec9e99ad690c3395bc4b313370b38ef355acdadcd122975b12c85ea5db8c6deb4aab71808dcb408fe3d1e7690c43d37b4ce6cc0166fa7daa';
const PUBKEY_2 =
    '203e205db4f19b37b60121b83a7333706db86431c6d835849957ed8c3928ad7927dc7234fd11d3e8c36c59277c3e6f149d5cd3cfa9a62aee49f8130962b4b3b9195e8aa5b7827463722b8c153931579d3505566b4edf48d498e185f0509de15204bb53b8977e5f92a0bc372742c4830944a59b4fe6b1c0466e2a6dad122b5d2e';
const PUBKEY_3 =
    '1014772f57bb9742735191cd5dcfe4ebbc04156b6878a0a7c9824f32ffb66e8506064e784db10e9051e52826e192715e8d7e478cb09a5e0012defa0694fbc7f5021e2335f3354bb7922ffcc2f38d3323dd9453ac49b55441452aeaca147711b2058e1d5681b5b9e0074b0f9c8d2c68a069b920d74521e79765036d57666c5597';
const NEGATED_MESSAGE_HASH =
    '093cccf0e7508f50d86197799d553d23be9a52fecf9fa7d309f3f6a6a0bae1dd25592fd60d368265921cb7232eec3492210e46b4b95682469e7590b0d2df6f28';
const AGG_SIG_ALL =
    '06a6497a71f97597f1acf925b1f67eca5b5dd8011f7140e08f484e57dc79bff61b8268216fa30b6505352cdde4fc0d71a005296166f81bfe8edbde2352a6abbf';
const AGG_SIG_FIRST_TWO =
    '29da90779ff721fffa657af0a02eb50fcb18cc8176e4d63127827a1767d69c7e227c651364e066d84349de32d97fd6b7f423a1e2b9a162ba061337d5a29e9303';

const IX_AGGREGATE_VERIFY = 0;
const IX_ADD_SIGNERS = 1;
const IX_VERIFY = 2;

const G2_POINT = 128;
const COUNT_PREFIX = 2;

const ERR_AGGREGATE_VERIFY_FAILED = 'InstructionErrorCustom { code: 3 }';
const ERR_INVALID_MULTISIG_ACCOUNT = 'InstructionErrorCustom { code: 4 }';
const ERR_MULTISIG_FULL = 'InstructionErrorCustom { code: 5 }';

const hex = (s: string) => Uint8Array.from(Buffer.from(s, 'hex'));

const concat = (...parts: Uint8Array[]) => {
    const total = parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
        out.set(part, offset);
        offset += part.length;
    }
    return out;
};

describe('bls-multisig', () => {
    const svm = new LiteSVM();
    let programId: Address;
    let payer: KeyPairSigner;

    before(async () => {
        programId = (await generateKeyPairSigner()).address;
        svm.addProgramFromFile(programId, 'tests/fixtures/bls_multisig_pinocchio_program.so');

        payer = await generateKeyPairSigner();
        svm.airdrop(payer.address, lamports(1_000_000_000n));
    });

    async function multisigAccount(owner: Address, capacity: number, members: string[]) {
        const address = (await generateKeyPairSigner()).address;
        const data = new Uint8Array(COUNT_PREFIX + capacity * G2_POINT);
        new DataView(data.buffer).setUint16(0, members.length, true);
        members.forEach((member, i) => data.set(hex(member), COUNT_PREFIX + i * G2_POINT));

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

    async function send(data: Uint8Array, multisig?: Address) {
        const accounts = multisig ? [{ address: multisig, role: AccountRole.WRITABLE }] : [];
        const transactionMessage = pipe(
            createTransactionMessage({ version: 0 }),
            m => setTransactionMessageFeePayerSigner(payer, m),
            m => svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
            m => appendTransactionMessageInstruction({ programAddress: programId, accounts, data }, m),
        );
        const signedTx = await signTransactionMessageWithSigners(transactionMessage);

        const result = svm.sendTransaction(signedTx);
        svm.expireBlockhash();
        return result;
    }

    const verifyData = (discriminator: number, aggSig: string) =>
        concat(new Uint8Array([discriminator]), hex(aggSig), hex(NEGATED_MESSAGE_HASH));

    it('stateless verify: aggregate of all signers passes the pairing check', async () => {
        const data = concat(verifyData(IX_AGGREGATE_VERIFY, AGG_SIG_ALL), hex(PUBKEY_1), hex(PUBKEY_2), hex(PUBKEY_3));
        const result = await send(data);

        assert(result instanceof TransactionMetadata, `transaction failed: ${result.toString()}`);
    });

    it('stateless verify: partial aggregate is rejected', async () => {
        const data = concat(
            verifyData(IX_AGGREGATE_VERIFY, AGG_SIG_FIRST_TWO),
            hex(PUBKEY_1),
            hex(PUBKEY_2),
            hex(PUBKEY_3),
        );
        const result = await send(data);

        assert(result instanceof FailedTransactionMetadata, 'expected the transaction to fail');
        assert.include(String(result.err()), ERR_AGGREGATE_VERIFY_FAILED);
    });

    it('add signers appends each pubkey and updates the count', async () => {
        const multisig = await multisigAccount(programId, 3, []);
        const data = concat(new Uint8Array([IX_ADD_SIGNERS]), hex(PUBKEY_1), hex(PUBKEY_2), hex(PUBKEY_3));
        const result = await send(data, multisig);

        assert(result instanceof TransactionMetadata, `transaction failed: ${result.toString()}`);
        const expected = concat(new Uint8Array([3, 0]), hex(PUBKEY_1), hex(PUBKEY_2), hex(PUBKEY_3));
        const account = svm.getAccount(multisig);
        assert(account?.exists, 'expected the multisig account to exist');
        assert.deepEqual(account.data, expected);
    });

    it('add signers beyond capacity is rejected', async () => {
        const multisig = await multisigAccount(programId, 2, []);
        const data = concat(new Uint8Array([IX_ADD_SIGNERS]), hex(PUBKEY_1), hex(PUBKEY_2), hex(PUBKEY_3));
        const result = await send(data, multisig);

        assert(result instanceof FailedTransactionMetadata, 'expected the transaction to fail');
        assert.include(String(result.err()), ERR_MULTISIG_FULL);
    });

    it('verify passes when every registered signer signed', async () => {
        const multisig = await multisigAccount(programId, 3, [PUBKEY_1, PUBKEY_2, PUBKEY_3]);
        const result = await send(verifyData(IX_VERIFY, AGG_SIG_ALL), multisig);

        assert(result instanceof TransactionMetadata, `transaction failed: ${result.toString()}`);
    });

    it('verify rejects an aggregate missing one registered signer', async () => {
        const multisig = await multisigAccount(programId, 3, [PUBKEY_1, PUBKEY_2, PUBKEY_3]);
        const result = await send(verifyData(IX_VERIFY, AGG_SIG_FIRST_TWO), multisig);

        assert(result instanceof FailedTransactionMetadata, 'expected the transaction to fail');
        assert.include(String(result.err()), ERR_AGGREGATE_VERIFY_FAILED);
    });

    it('verify rejects an account not owned by the program', async () => {
        const foreignOwner = (await generateKeyPairSigner()).address;
        const multisig = await multisigAccount(foreignOwner, 3, [PUBKEY_1, PUBKEY_2, PUBKEY_3]);
        const result = await send(verifyData(IX_VERIFY, AGG_SIG_ALL), multisig);

        assert(result instanceof FailedTransactionMetadata, 'expected the transaction to fail');
        assert.include(String(result.err()), ERR_INVALID_MULTISIG_ACCOUNT);
    });
});
