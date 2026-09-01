import * as path from 'node:path';
import {
    AccountRole,
    type Address,
    addEncoderSizePrefix,
    appendTransactionMessageInstruction,
    createTransactionMessage,
    generateKeyPairSigner,
    getStructEncoder,
    getU32Encoder,
    getUtf8Encoder,
    lamports,
    pipe,
    setTransactionMessageFeePayerSigner,
    signTransactionMessageWithSigners,
    unwrapOption,
} from '@solana/kit';
import { SYSTEM_PROGRAM_ADDRESS } from '@solana-program/system';
import { getMintDecoder, TOKEN_2022_PROGRAM_ADDRESS } from '@solana-program/token-2022';
import { assert } from 'chai';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';

// Instruction data layout: the Borsh-encoded metadata forwarded to the metadata
// `Initialize` CPI. A Borsh `String` is a u32 little-endian length prefix
// followed by its UTF-8 bytes.
const borshString = addEncoderSizePrefix(getUtf8Encoder(), getU32Encoder());
const metadataEncoder = getStructEncoder([
    ['name', borshString],
    ['symbol', borshString],
    ['uri', borshString],
]);

// The mint starts at 234 bytes (base 166 + MetadataPointer TLV of 68), then the
// metadata `Initialize` reallocs it to add the TokenMetadata TLV:
//   4 (TLV header) + 64 (update authority + mint) + 4 (empty additional vec) +
//   the encoded name/symbol/uri = 72 + metadata length.
const MINT_SIZE_WITH_POINTER = 234;
const METADATA_TLV_BASE = 72;

// The compiled program artifact, produced by `build-and-test` into ./fixtures.
// The npm scripts always run from the package root, so resolve from the cwd.
const PROGRAM_SO = path.join(process.cwd(), 'tests', 'fixtures', 'token_2022_metadata_pinocchio_program.so');

describe('Token-2022 Metadata (Pinocchio)', () => {
    let svm: LiteSVM;
    let programId: Address;

    before(async () => {
        svm = new LiteSVM();
        // The program never asserts its own id, so any address works; a generated
        // one keeps the test self-contained.
        programId = (await generateKeyPairSigner()).address;
        svm.addProgramFromFile(programId, PROGRAM_SO);
    });

    it('Creates a Token-2022 mint with on-chain metadata', async () => {
        const payer = await generateKeyPairSigner();
        svm.airdrop(payer.address, lamports(1_000_000_000n));

        const mint = await generateKeyPairSigner();

        const name = 'Solana Gold';
        const symbol = 'GOLD';
        const uri =
            'https://raw.githubusercontent.com/solana-developers/opos-asset/main/assets/DeveloperPortal/metadata.json';
        const data = metadataEncoder.encode({ name, symbol, uri });

        const ix = {
            programAddress: programId,
            accounts: [
                { address: mint.address, role: AccountRole.WRITABLE_SIGNER, signer: mint }, // mint account
                { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer }, // payer (mint + update authority)
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY }, // system program
                { address: TOKEN_2022_PROGRAM_ADDRESS, role: AccountRole.READONLY }, // Token-2022 program
            ],
            data,
        };

        const transactionMessage = pipe(
            createTransactionMessage({ version: 0 }),
            m => setTransactionMessageFeePayerSigner(payer, m),
            m => svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
            m => appendTransactionMessageInstruction(ix, m),
        );

        const signedTx = await signTransactionMessageWithSigners(transactionMessage);
        const result = svm.sendTransaction(signedTx);
        if (result instanceof FailedTransactionMetadata) {
            throw new Error(`Transaction failed: ${result.err()}`);
        }

        const mintAccount = svm.getAccount(mint.address);
        if (!mintAccount?.exists) throw new Error('Mint account not found');

        // Owned by Token-2022, and reallocated to fit the base mint, the metadata
        // pointer, and the variable-length metadata.
        assert.equal(mintAccount.programAddress, TOKEN_2022_PROGRAM_ADDRESS);
        assert.equal(mintAccount.data.length, MINT_SIZE_WITH_POINTER + METADATA_TLV_BASE + data.length);

        // Decode the base mint fields and its TLV extensions with the official
        // Token-2022 codec instead of reading raw byte offsets by hand.
        const mintState = getMintDecoder().decode(mintAccount.data);
        assert.equal(mintState.decimals, 2);

        const extensions = unwrapOption(mintState.extensions) ?? [];

        // The metadata pointer points the mint at itself.
        const pointer = extensions.find(e => e.__kind === 'MetadataPointer');
        if (pointer?.__kind !== 'MetadataPointer') {
            throw new Error('MetadataPointer extension not found on the mint');
        }
        assert.equal(unwrapOption(pointer.metadataAddress), mint.address);

        // The on-chain metadata was written into the mint.
        const metadata = extensions.find(e => e.__kind === 'TokenMetadata');
        if (metadata?.__kind !== 'TokenMetadata') {
            throw new Error('TokenMetadata extension not found on the mint');
        }
        assert.equal(metadata.name, name);
        assert.equal(metadata.symbol, symbol);
        assert.equal(metadata.uri, uri);
        assert.equal(metadata.mint, mint.address);

        console.log('Mint address:', mint.address);
    });
});
