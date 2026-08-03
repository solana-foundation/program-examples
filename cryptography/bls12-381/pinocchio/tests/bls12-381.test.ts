import {
    type Address,
    appendTransactionMessageInstruction,
    createTransactionMessage,
    generateKeyPairSigner,
    getBase16Codec,
    type KeyPairSigner,
    type ReadonlyUint8Array,
    lamports,
    pipe,
    setTransactionMessageFeePayerSigner,
    signTransactionMessageWithSigners,
} from '@solana/kit';
import { assert } from 'chai';
import { FailedTransactionMetadata, LiteSVM, TransactionMetadata } from 'litesvm';

// Big-endian BLS12-381 points: multiples of the G1 and G2 generators, so
// GEN + 2*GEN == 3*GEN and 3*GEN - 2*GEN == GEN.
const G1_GEN =
    '17f1d3a73197d7942695638c4fa9ac0fc3688c4f9774b905a14e3a3f171bac586c55e83ff97a1aeffb3af00adb22c6bb08b3f481e3aaa0f1a09e30ed741d8ae4fcf5e095d5d00af600db18cb2c04b3edd03cc744a2888ae40caa232946c5e7e1';
const G1_TWO =
    '0572cbea904d67468808c8eb50a9450c9721db309128012543902d0ac358a62ae28f75bb8f1c7c42c39a8c5529bf0f4e166a9d8cabc673a322fda673779d8e3822ba3ecb8670e461f73bb9021d5fd76a4c56d9d4cd16bd1bba86881979749d28';
const G1_THREE =
    '09ece308f9d1f0131765212deca99697b112d61f9be9a5f1f3780a51335b3ff981747a0b2ca2179b96d2c0c9024e5224032b80d3a6f5b09f8a84623389c5f80ca69a0cddabc3097f9d9c27310fd43be6e745256c634af45ca3473b0590ae30d1';
const G2_GEN =
    '13e02b6052719f607dacd3a088274f65596bd0d09920b61ab5da61bbdc7f5049334cf11213945d57e5ac7d055d042b7e024aa2b2f08f0a91260805272dc51051c6e47ad4fa403b02b4510b647ae3d1770bac0326a805bbefd48056c8c121bdb80606c4a02ea734cc32acd2b02bc28b99cb3e287e85a763af267492ab572e99ab3f370d275cec1da1aaa9075ff05f79be0ce5d527727d6e118cc9cdc6da2e351aadfd9baa8cbdd3a76d429a695160d12c923ac9cc3baca289e193548608b82801';
const G2_TWO =
    '0a4edef9c1ed7f729f520e47730a124fd70662a904ba1074728114d1031e1572c6c886f6b57ec72a6178288c47c335771638533957d540a9d2370f17cc7ed5863bc0b995b8825e0ee1ea1e1e4d00dbae81f14b0bf3611b78c952aacab827a0530f6d4552fa65dd2638b361543f887136a43253d9c66c411697003f7a13c308f5422e1aa0a59c8967acdefd8b6e36ccf30468fb440d82b0630aeb8dca2b5256789a66da69bf91009cbfe6bd221e47aa8ae88dece9764bf3bd999d95d71e4c9899';
const G2_THREE =
    '09380275bbc8e5dcea7dc4dd7e0550ff2ac480905396eda55062650f8d251c96eb480673937cc6d9d6a44aaa56ca66dc122915c824a0857e2ee414a3dccb23ae691ae54329781315a0c75df1c04d6d7a50a030fc866f09d516020ef82324afae08f239ba329b3967fe48d718a36cfe5f62a7e42e0bf1c1ed714150a166bfbd6bcf6b3b58b975b9edea56d53f23a0e8490b21da7955969e61010c7a1abc1a6f0136961d1e3b20b1a7326ac738fef5c721479dfd948b52fdf2455e44813ecfd892';

// Instruction discriminators, mirroring the program's dispatch order.
const IX_G1_ADD = 0;
const IX_G1_SUB = 1;
const IX_G1_MUL = 2;
const IX_G2_ADD = 3;
const IX_G2_SUB = 4;
const IX_G2_MUL = 5;

const base16 = getBase16Codec();
const hex = (s: string) => base16.encode(s);

const scalarThree = () => {
    const scalar = new Uint8Array(32);
    scalar[31] = 3;
    return scalar;
};

describe('bls12-381', () => {
    const svm = new LiteSVM();
    let programId: Address;
    let payer: KeyPairSigner;

    before(async () => {
        programId = (await generateKeyPairSigner()).address;
        svm.addProgramFromFile(programId, 'tests/fixtures/bls12_381_pinocchio_program.so');

        payer = await generateKeyPairSigner();
        svm.airdrop(payer.address, lamports(1_000_000_000n));
    });

    async function send(discriminator: number, left: ReadonlyUint8Array, right: ReadonlyUint8Array) {
        const data = new Uint8Array([discriminator, ...left, ...right]);

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

    async function expectReturnData(
        discriminator: number,
        left: ReadonlyUint8Array,
        right: ReadonlyUint8Array,
        expected: ReadonlyUint8Array,
    ) {
        const result = await send(discriminator, left, right);
        assert(result instanceof TransactionMetadata, `transaction failed: ${result.toString()}`);
        assert.deepEqual<ReadonlyUint8Array>(result.returnData().data(), expected);
    }

    it('G1 add: G + 2G == 3G', async () => {
        await expectReturnData(IX_G1_ADD, hex(G1_GEN), hex(G1_TWO), hex(G1_THREE));
    });

    it('G1 sub: 3G - 2G == G', async () => {
        await expectReturnData(IX_G1_SUB, hex(G1_THREE), hex(G1_TWO), hex(G1_GEN));
    });

    it('G1 mul: G * 3 == 3G', async () => {
        await expectReturnData(IX_G1_MUL, scalarThree(), hex(G1_GEN), hex(G1_THREE));
    });

    it('G2 add: G + 2G == 3G', async () => {
        await expectReturnData(IX_G2_ADD, hex(G2_GEN), hex(G2_TWO), hex(G2_THREE));
    });

    it('G2 sub: 3G - 2G == G', async () => {
        await expectReturnData(IX_G2_SUB, hex(G2_THREE), hex(G2_TWO), hex(G2_GEN));
    });

    it('G2 mul: G * 3 == 3G', async () => {
        await expectReturnData(IX_G2_MUL, scalarThree(), hex(G2_GEN), hex(G2_THREE));
    });

    it('rejects input that is not two whole operands', async () => {
        const result = await send(IX_G1_ADD, new Uint8Array(3), new Uint8Array(0));

        assert(result instanceof FailedTransactionMetadata, 'expected the transaction to fail');
        assert.include(String(result.err()), 'InstructionErrorCustom { code: 0 }');
    });
});
