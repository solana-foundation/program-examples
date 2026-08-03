import { Buffer } from 'node:buffer';
import {
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

// Big-endian alt_bn128 G2 points derived from the BN254 G2 generator:
// GENERATOR + 2*GENERATOR == 3*GENERATOR.
const G2_GENERATOR =
    '198e9393920d483a7260bfb731fb5d25f1aa493335a9e71297e485b7aef312c21800deef121f1e76426a00665e5c4479674322d4f75edadd46debd5cd992f6ed090689d0585ff075ec9e99ad690c3395bc4b313370b38ef355acdadcd122975b12c85ea5db8c6deb4aab71808dcb408fe3d1e7690c43d37b4ce6cc0166fa7daa';
const G2_TWO_GENERATOR =
    '203e205db4f19b37b60121b83a7333706db86431c6d835849957ed8c3928ad7927dc7234fd11d3e8c36c59277c3e6f149d5cd3cfa9a62aee49f8130962b4b3b9195e8aa5b7827463722b8c153931579d3505566b4edf48d498e185f0509de15204bb53b8977e5f92a0bc372742c4830944a59b4fe6b1c0466e2a6dad122b5d2e';
const G2_THREE_GENERATOR =
    '1014772f57bb9742735191cd5dcfe4ebbc04156b6878a0a7c9824f32ffb66e8506064e784db10e9051e52826e192715e8d7e478cb09a5e0012defa0694fbc7f5021e2335f3354bb7922ffcc2f38d3323dd9453ac49b55441452aeaca147711b2058e1d5681b5b9e0074b0f9c8d2c68a069b920d74521e79765036d57666c5597';

const IX_G2_ADD = 0;
const IX_G2_MUL = 1;

const hex = (s: string) => Uint8Array.from(Buffer.from(s, 'hex'));

describe('alt-bn128-g2', () => {
    const svm = new LiteSVM();
    let programId: Address;
    let payer: KeyPairSigner;

    before(async () => {
        programId = (await generateKeyPairSigner()).address;
        svm.addProgramFromFile(programId, 'tests/fixtures/alt_bn128_g2_pinocchio_program.so');

        payer = await generateKeyPairSigner();
        svm.airdrop(payer.address, lamports(1_000_000_000n));
    });

    async function send(discriminator: number, input: Uint8Array) {
        const data = new Uint8Array(1 + input.length);
        data[0] = discriminator;
        data.set(input, 1);

        const transactionMessage = pipe(
            createTransactionMessage({ version: 0 }),
            m => setTransactionMessageFeePayerSigner(payer, m),
            m => svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
            m => appendTransactionMessageInstruction({ programAddress: programId, accounts: [], data }, m),
        );
        const signedTx = await signTransactionMessageWithSigners(transactionMessage);

        const result = svm.sendTransaction(signedTx);
        svm.expireBlockhash();
        return result;
    }

    it('adds two G2 points: G + 2G == 3G', async () => {
        const result = await send(IX_G2_ADD, new Uint8Array([...hex(G2_GENERATOR), ...hex(G2_TWO_GENERATOR)]));

        assert(result instanceof TransactionMetadata, `transaction failed: ${result.toString()}`);
        assert.deepEqual(result.returnData().data(), hex(G2_THREE_GENERATOR));
    });

    it('multiplies a G2 point by a scalar: G * 3 == 3G', async () => {
        const scalar = new Uint8Array(32);
        scalar[31] = 3;
        const result = await send(IX_G2_MUL, new Uint8Array([...hex(G2_GENERATOR), ...scalar]));

        assert(result instanceof TransactionMetadata, `transaction failed: ${result.toString()}`);
        assert.deepEqual(result.returnData().data(), hex(G2_THREE_GENERATOR));
    });

    it('rejects input that is not two whole G2 points', async () => {
        const result = await send(IX_G2_ADD, new Uint8Array(255));

        assert(result instanceof FailedTransactionMetadata, 'expected the transaction to fail');
        assert.include(String(result.err()), 'InstructionErrorCustom { code: 0 }');
    });
});
