import { Buffer } from 'node:buffer';
import * as path from 'node:path';
import {
    AccountRole,
    addEncoderSizePrefix,
    address,
    appendTransactionMessageInstruction,
    createTransactionMessage,
    generateKeyPairSigner,
    getAddressEncoder,
    getProgramDerivedAddress,
    getStructEncoder,
    getU8Encoder,
    getU32Encoder,
    getUtf8Encoder,
    lamports,
    pipe,
    setTransactionMessageFeePayerSigner,
    signTransactionMessageWithSigners,
} from '@solana/kit';
import { SYSTEM_PROGRAM_ADDRESS } from '@solana-program/system';
import { TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import { assert } from 'chai';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';

// The legacy SPL Token program is bundled with LiteSVM's standard runtime. The
// Metaplex Token Metadata program is not, so it is dumped from mainnet into
// tests/fixtures by prepare.mjs and loaded below. There is no official
// `@solana-program/*` client for Token Metadata, so its id stays hand-rolled.
const TOKEN_METADATA_PROGRAM_ID = address('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

// Instruction data layout, matching the program's `CreateTokenArgs`.
const createTokenArgsEncoder = getStructEncoder([
    ['tokenTitle', addEncoderSizePrefix(getUtf8Encoder(), getU32Encoder())],
    ['tokenSymbol', addEncoderSizePrefix(getUtf8Encoder(), getU32Encoder())],
    ['tokenUri', addEncoderSizePrefix(getUtf8Encoder(), getU32Encoder())],
    ['tokenDecimals', getU8Encoder()],
]);

// The compiled program artifacts live in ./fixtures: the pinocchio program is
// built there by `build-and-test`, and token_metadata.so is dumped from mainnet
// by prepare.mjs. The npm scripts always run from the package root.
const FIXTURES = path.join(process.cwd(), 'tests', 'fixtures');
const PROGRAM_SO = path.join(FIXTURES, 'create_token_pinocchio_program.so');
const TOKEN_METADATA_SO = path.join(FIXTURES, 'token_metadata.so');

const addressEncoder = getAddressEncoder();

describe('Create Token (Pinocchio)', () => {
    let svm: LiteSVM;
    let programId: ReturnType<typeof address>;
    let payer: Awaited<ReturnType<typeof generateKeyPairSigner>>;

    before(async () => {
        svm = new LiteSVM();
        // The program never asserts its own id, so any address works; a generated
        // one keeps the test self-contained.
        programId = (await generateKeyPairSigner()).address;
        svm.addProgramFromFile(programId, PROGRAM_SO);
        svm.addProgramFromFile(TOKEN_METADATA_PROGRAM_ID, TOKEN_METADATA_SO);

        payer = await generateKeyPairSigner();
        svm.airdrop(payer.address, lamports(10_000_000_000n));
    });

    async function createToken(name: string, symbol: string, uri: string, decimals: number) {
        const mint = await generateKeyPairSigner();
        const [metadataAddress] = await getProgramDerivedAddress({
            programAddress: TOKEN_METADATA_PROGRAM_ID,
            seeds: ['metadata', addressEncoder.encode(TOKEN_METADATA_PROGRAM_ID), addressEncoder.encode(mint.address)],
        });

        const data = createTokenArgsEncoder.encode({
            tokenTitle: name,
            tokenSymbol: symbol,
            tokenUri: uri,
            tokenDecimals: decimals,
        });

        const ix = {
            programAddress: programId,
            accounts: [
                { address: mint.address, role: AccountRole.WRITABLE_SIGNER, signer: mint }, // mint account
                { address: payer.address, role: AccountRole.READONLY }, // mint authority
                { address: metadataAddress, role: AccountRole.WRITABLE }, // metadata account
                { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer }, // payer
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY }, // system program
                { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY }, // token program
                { address: TOKEN_METADATA_PROGRAM_ID, role: AccountRole.READONLY }, // token metadata program
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

        return { mint: mint.address, metadata: metadataAddress };
    }

    it('Create an SPL Token!', async () => {
        const { mint, metadata } = await createToken(
            'Solana Gold',
            'GOLDSOL',
            'https://raw.githubusercontent.com/solana-developers/program-examples/new-examples/tokens/tokens/.assets/spl-token.json',
            9,
        );

        const mintAccount = svm.getAccount(mint);
        if (!mintAccount?.exists) throw new Error('Mint account not found');
        assert.equal(mintAccount.programAddress, TOKEN_PROGRAM_ADDRESS);

        const metadataAccount = svm.getAccount(metadata);
        if (!metadataAccount?.exists) throw new Error('Metadata account not found');
        assert.equal(metadataAccount.programAddress, TOKEN_METADATA_PROGRAM_ID);
        assert.isTrue(Buffer.from(metadataAccount.data).toString('utf-8').includes('Solana Gold'));
    });

    it('Create an NFT!', async () => {
        const { mint, metadata } = await createToken(
            'Homer NFT',
            'HOMR',
            'https://raw.githubusercontent.com/solana-developers/program-examples/new-examples/tokens/tokens/.assets/nft.json',
            0,
        );

        const mintAccount = svm.getAccount(mint);
        if (!mintAccount?.exists) throw new Error('Mint account not found');
        assert.equal(mintAccount.programAddress, TOKEN_PROGRAM_ADDRESS);

        const metadataAccount = svm.getAccount(metadata);
        if (!metadataAccount?.exists) throw new Error('Metadata account not found');
        assert.equal(metadataAccount.programAddress, TOKEN_METADATA_PROGRAM_ID);
        assert.isTrue(Buffer.from(metadataAccount.data).toString('utf-8').includes('Homer NFT'));
    });
});
