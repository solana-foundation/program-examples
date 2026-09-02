import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import {
    AccountRole,
    type Address,
    address,
    appendTransactionMessageInstruction,
    createTransactionMessage,
    generateKeyPairSigner,
    lamports,
    pipe,
    setTransactionMessageFeePayerSigner,
    signTransactionMessageWithSigners,
} from '@solana/kit';
import { assert } from 'chai';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';

// The Pyth Pull Oracle receiver program, which owns real `PriceUpdateV2`
// accounts. The program checks the account's owner before reading it.
const PYTH_RECEIVER_PROGRAM_ADDRESS = address('rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ');

// The compiled program artifact, produced by `build-and-test` into ./fixtures.
// The npm scripts always run from the package root, so resolve from the cwd.
const PROGRAM_SO = path.join(process.cwd(), 'tests', 'fixtures', 'pyth_pinocchio_program.so');

// A real SOL/USD price update account, dumped from mainnet by prepare.mjs. The
// mock accounts below are self-consistent by construction, so they cannot catch
// a layout that has drifted from the one Pyth actually writes; this can.
const FIXTURE = path.join(process.cwd(), 'tests', 'fixtures', 'sol_usd_price_update.json');

// Anchor account discriminator for `PriceUpdateV2`.
const DISCRIMINATOR = Uint8Array.from([34, 241, 35, 99, 157, 126, 244, 205]);

// `VerificationLevel` is a Borsh enum: `Partial { num_signatures: u8 }` is the
// first variant (two bytes) and `Full` the second (one byte).
const VERIFICATION_LEVEL_PARTIAL = 0;
const VERIFICATION_LEVEL_FULL = 1;

// Offsets within the account, and of the fields inside the price message.
const VERIFICATION_LEVEL_OFFSET = 8 + 32;
const PRICE_OFFSET = 32;
const EXPONENT_OFFSET = 48;

// The example price feed values, encoded into a mock `PriceUpdateV2` account.
const PRICE = 6_237_450_000n; // e.g. $62.37 at exponent -8
const CONF = 4_500_000n;
const EXPONENT = -8;
const PUBLISH_TIME = 1_728_000_000n;

// Builds the bytes of a `PriceUpdateV2` account with the given verification
// level:
//   discriminator (8) + write_authority (32) + verification_level (1 or 2) +
//   PriceFeedMessage { feed_id [32], price i64, conf u64, exponent i32,
//   publish_time i64, prev_publish_time i64, ema_price i64, ema_conf u64 } +
//   posted_slot (8).
//
// `Partial` carries a signature count and so takes one byte more than `Full`,
// shifting the price message along with it. Encoding that shift here is what
// makes the partial-verification test meaningful — writing the message at a
// fixed offset would leave the program's dynamic offset untested.
function encodePriceUpdate(verificationLevel = VERIFICATION_LEVEL_FULL): Uint8Array {
    const levelSize = verificationLevel === VERIFICATION_LEVEL_FULL ? 1 : 2;
    const buffer = new Uint8Array(8 + 32 + levelSize + 32 + 8 + 8 + 4 + 8 + 8 + 8 + 8 + 8);
    const view = new DataView(buffer.buffer);
    let offset = 0;
    buffer.set(DISCRIMINATOR, offset);
    offset += 8;
    offset += 32; // write_authority (left as zeros)
    buffer[offset] = verificationLevel;
    offset += levelSize; // Partial's num_signatures byte is left as zero
    offset += 32; // feed_id (left as zeros)
    view.setBigInt64(offset, PRICE, true);
    offset += 8;
    view.setBigUint64(offset, CONF, true);
    offset += 8;
    view.setInt32(offset, EXPONENT, true);
    offset += 4;
    view.setBigInt64(offset, PUBLISH_TIME, true);
    return buffer;
}

describe('Pyth (Pinocchio)', () => {
    let svm: LiteSVM;
    let programId: Address;

    before(async () => {
        svm = new LiteSVM();
        programId = (await generateKeyPairSigner()).address;
        svm.addProgramFromFile(programId, PROGRAM_SO);
    });

    it('Reads the price from a Pyth price update account', async () => {
        const payer = await generateKeyPairSigner();
        svm.airdrop(payer.address, lamports(1_000_000_000n));

        // Inject a mock price update account owned by the Pyth receiver program.
        const priceUpdate = await generateKeyPairSigner();
        const data = encodePriceUpdate();
        svm.setAccount({
            address: priceUpdate.address,
            data,
            executable: false,
            lamports: lamports(svm.minimumBalanceForRentExemption(BigInt(data.length))),
            programAddress: PYTH_RECEIVER_PROGRAM_ADDRESS,
            space: BigInt(data.length),
        });

        const ix = {
            programAddress: programId,
            accounts: [{ address: priceUpdate.address, role: AccountRole.READONLY }],
            data: new Uint8Array(),
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

        // The program logs the parsed fields; assert the values it read back.
        const logs = result.logs();
        assert.include(logs, `Program log: Price: ${PRICE}`);
        assert.include(logs, `Program log: Confidence: ${CONF}`);
        assert.include(logs, `Program log: Exponent: ${EXPONENT}`);
        assert.include(logs, `Program log: Publish time: ${PUBLISH_TIME}`);
    });

    it('Rejects an account not owned by the Pyth receiver program', async () => {
        const payer = await generateKeyPairSigner();
        svm.airdrop(payer.address, lamports(1_000_000_000n));

        // Same data, but owned by an arbitrary program.
        const priceUpdate = await generateKeyPairSigner();
        const data = encodePriceUpdate();
        svm.setAccount({
            address: priceUpdate.address,
            data,
            executable: false,
            lamports: lamports(svm.minimumBalanceForRentExemption(BigInt(data.length))),
            programAddress: address('11111111111111111111111111111111'), // the system program, not Pyth
            space: BigInt(data.length),
        });

        const ix = {
            programAddress: programId,
            accounts: [{ address: priceUpdate.address, role: AccountRole.READONLY }],
            data: new Uint8Array(),
        };
        const tx = pipe(
            createTransactionMessage({ version: 0 }),
            m => setTransactionMessageFeePayerSigner(payer, m),
            m => svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
            m => appendTransactionMessageInstruction(ix, m),
        );
        const result = svm.sendTransaction(await signTransactionMessageWithSigners(tx));
        assert.instanceOf(result, FailedTransactionMetadata, 'expected the wrong-owner account to be rejected');
    });

    it('Rejects an account with an unknown verification level', async () => {
        const payer = await generateKeyPairSigner();
        svm.airdrop(payer.address, lamports(1_000_000_000n));

        // Receiver-owned, but the verification level is neither Full (1) nor
        // Partial (0), so the account must be rejected rather than misparsed.
        const priceUpdate = await generateKeyPairSigner();
        const data = encodePriceUpdate(2);
        svm.setAccount({
            address: priceUpdate.address,
            data,
            executable: false,
            lamports: lamports(svm.minimumBalanceForRentExemption(BigInt(data.length))),
            programAddress: PYTH_RECEIVER_PROGRAM_ADDRESS,
            space: BigInt(data.length),
        });

        const ix = {
            programAddress: programId,
            accounts: [{ address: priceUpdate.address, role: AccountRole.READONLY }],
            data: new Uint8Array(),
        };
        const tx = pipe(
            createTransactionMessage({ version: 0 }),
            m => setTransactionMessageFeePayerSigner(payer, m),
            m => svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
            m => appendTransactionMessageInstruction(ix, m),
        );
        const result = svm.sendTransaction(await signTransactionMessageWithSigners(tx));
        assert.instanceOf(result, FailedTransactionMetadata, 'expected the unknown verification level to be rejected');
    });

    it('Reads a partially verified update, whose message sits one byte later', async () => {
        const payer = await generateKeyPairSigner();
        svm.airdrop(payer.address, lamports(1_000_000_000n));

        // Same values as the `Full` case, but the extra `num_signatures` byte
        // pushes the price message along. A program that hardcoded the `Full`
        // offset would report garbage here rather than the values below.
        const priceUpdate = await generateKeyPairSigner();
        const data = encodePriceUpdate(VERIFICATION_LEVEL_PARTIAL);
        svm.setAccount({
            address: priceUpdate.address,
            data,
            executable: false,
            lamports: lamports(svm.minimumBalanceForRentExemption(BigInt(data.length))),
            programAddress: PYTH_RECEIVER_PROGRAM_ADDRESS,
            space: BigInt(data.length),
        });

        const ix = {
            programAddress: programId,
            accounts: [{ address: priceUpdate.address, role: AccountRole.READONLY }],
            data: new Uint8Array(),
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

        const logs = result.logs();
        assert.include(logs, `Program log: Price: ${PRICE}`);
        assert.include(logs, `Program log: Exponent: ${EXPONENT}`);
        assert.include(logs, `Program log: Publish time: ${PUBLISH_TIME}`);
    });

    it('Reads the real SOL/USD feed dumped from mainnet', async () => {
        const payer = await generateKeyPairSigner();
        svm.airdrop(payer.address, lamports(1_000_000_000n));

        // The account goes in exactly as mainnet returned it, owner included.
        const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'));
        const data = Buffer.from(fixture.account.data[0], 'base64');
        const priceUpdate = address(fixture.pubkey);
        assert.equal(fixture.account.owner, PYTH_RECEIVER_PROGRAM_ADDRESS, 'fixture should be receiver-owned');
        svm.setAccount({
            address: priceUpdate,
            data,
            executable: false,
            lamports: lamports(BigInt(fixture.account.lamports)),
            programAddress: address(fixture.account.owner),
            space: BigInt(data.length),
        });

        // Decode the same fields independently, so the assertion pins the
        // program's parsing against the bytes Pyth really publishes.
        const messageOffset =
            VERIFICATION_LEVEL_OFFSET + (data[VERIFICATION_LEVEL_OFFSET] === VERIFICATION_LEVEL_FULL ? 1 : 2);
        const price = data.readBigInt64LE(messageOffset + PRICE_OFFSET);
        const exponent = data.readInt32LE(messageOffset + EXPONENT_OFFSET);

        const ix = {
            programAddress: programId,
            accounts: [{ address: priceUpdate, role: AccountRole.READONLY }],
            data: new Uint8Array(),
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

        const logs = result.logs();
        assert.include(logs, `Program log: Price: ${price}`);
        assert.include(logs, `Program log: Exponent: ${exponent}`);
    });
});
