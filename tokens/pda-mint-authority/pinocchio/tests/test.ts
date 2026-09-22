import { Buffer } from 'node:buffer';
import * as path from 'node:path';
import {
    AccountRole,
    address,
    addEncoderSizePrefix,
    appendTransactionMessageInstruction,
    createTransactionMessage,
    generateKeyPairSigner,
    getAddressEncoder,
    getProgramDerivedAddress,
    getStructEncoder,
    getU32Encoder,
    getU8Encoder,
    getUtf8Encoder,
    lamports,
    pipe,
    setTransactionMessageFeePayerSigner,
    signTransactionMessageWithSigners,
} from '@solana/kit';
import { SYSTEM_PROGRAM_ADDRESS } from '@solana-program/system';
import {
    ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
    findAssociatedTokenPda,
    getTokenDecoder,
    TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token';
import { assert } from 'chai';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';

// The legacy SPL Token and Associated Token Account programs are bundled with
// LiteSVM's standard runtime, and their ids come from the official
// @solana-program/token client. The Metaplex Token Metadata program is not
// bundled and has no official @solana-program client, so its id stays
// hand-rolled and it is dumped from mainnet into tests/fixtures by prepare.mjs.
const TOKEN_METADATA_PROGRAM_ID = address('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

// Instruction discriminators (the Borsh enum variant index).
const INIT = 0;
const CREATE = 1;
const MINT = 2;

// Create instruction data layout, matching the program's `CreateTokenArgs` (and
// the native example's wire format). Borsh strings are a u32-LE length prefix
// followed by the UTF-8 bytes.
const borshString = () => addEncoderSizePrefix(getUtf8Encoder(), getU32Encoder());
const createTokenArgsEncoder = getStructEncoder([
    ['instruction', getU8Encoder()],
    ['nftTitle', borshString()],
    ['nftSymbol', borshString()],
    ['nftUri', borshString()],
]);

// The compiled program artifacts live in ./fixtures: the pinocchio program is
// built there by `build-and-test`, and token_metadata.so is dumped from mainnet
// by prepare.mjs. The npm scripts always run from the package root.
const FIXTURES = path.join(process.cwd(), 'tests', 'fixtures');
const PROGRAM_SO = path.join(FIXTURES, 'pda_mint_authority_pinocchio_program.so');
const TOKEN_METADATA_SO = path.join(FIXTURES, 'token_metadata.so');

const addressEncoder = getAddressEncoder();

async function getMetadataAddress(mint: ReturnType<typeof address>) {
    const [metadata] = await getProgramDerivedAddress({
        programAddress: TOKEN_METADATA_PROGRAM_ID,
        seeds: ['metadata', addressEncoder.encode(TOKEN_METADATA_PROGRAM_ID), addressEncoder.encode(mint)],
    });
    return metadata;
}

async function getMasterEditionAddress(mint: ReturnType<typeof address>) {
    const [edition] = await getProgramDerivedAddress({
        programAddress: TOKEN_METADATA_PROGRAM_ID,
        seeds: ['metadata', addressEncoder.encode(TOKEN_METADATA_PROGRAM_ID), addressEncoder.encode(mint), 'edition'],
    });
    return edition;
}

describe('PDA Mint Authority (Pinocchio)', () => {
    let svm: LiteSVM;
    let programId: ReturnType<typeof address>;
    let payer: Awaited<ReturnType<typeof generateKeyPairSigner>>;
    let mint: Awaited<ReturnType<typeof generateKeyPairSigner>>;
    let mintAuthorityPda: ReturnType<typeof address>;
    let mintAuthorityBump: number;
    let mintConfigPda: ReturnType<typeof address>;

    before(async () => {
        svm = new LiteSVM();
        // The program never asserts its own id, so any address works; a generated
        // one keeps the test self-contained.
        programId = (await generateKeyPairSigner()).address;
        svm.addProgramFromFile(programId, PROGRAM_SO);
        svm.addProgramFromFile(TOKEN_METADATA_PROGRAM_ID, TOKEN_METADATA_SO);

        payer = await generateKeyPairSigner();
        svm.airdrop(payer.address, lamports(10_000_000_000n));
        // The mint is created in the Create test and reused (as a non-signer) by the
        // Mint test, so it is generated once for the whole suite.
        mint = await generateKeyPairSigner();

        // The mint authority is a PDA of the program; its canonical bump is passed
        // into Init and later used by the program to sign CPIs (invoke_signed).
        const [pda, bump] = await getProgramDerivedAddress({
            programAddress: programId,
            seeds: ['mint_authority'],
        });
        mintAuthorityPda = pda;
        mintAuthorityBump = bump;

        const [configPda] = await getProgramDerivedAddress({
            programAddress: programId,
            seeds: ['mint_config', addressEncoder.encode(mint.address)],
        });
        mintConfigPda = configPda;
    });

    async function send<TInstruction extends Parameters<typeof appendTransactionMessageInstruction>[0]>(
        ix: TInstruction,
    ) {
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
    }

    it('Initialize the mint authority PDA!', async () => {
        await send({
            programAddress: programId,
            accounts: [
                { address: mintAuthorityPda, role: AccountRole.WRITABLE }, // mint authority PDA
                { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer }, // payer
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY }, // system program
            ],
            data: new Uint8Array([INIT, mintAuthorityBump]),
        });

        const pdaAccount = svm.getAccount(mintAuthorityPda);
        if (!pdaAccount?.exists) throw new Error('Mint authority PDA not found');
        assert.equal(pdaAccount.programAddress, programId);
        // The program persists the canonical bump in the first byte.
        assert.equal(pdaAccount.data[0], mintAuthorityBump);
    });

    it('Create an NFT!', async () => {
        const metadataAddress = await getMetadataAddress(mint.address);

        const data = createTokenArgsEncoder.encode({
            instruction: CREATE,
            nftTitle: 'Homer NFT',
            nftSymbol: 'HOMR',
            nftUri: 'https://raw.githubusercontent.com/solana-developers/program-examples/new-examples/tokens/tokens/.assets/nft.json',
        });

        await send({
            programAddress: programId,
            accounts: [
                { address: mint.address, role: AccountRole.WRITABLE_SIGNER, signer: mint }, // mint account
                { address: mintAuthorityPda, role: AccountRole.READONLY }, // mint authority PDA
                { address: mintConfigPda, role: AccountRole.WRITABLE }, // mint config PDA
                { address: metadataAddress, role: AccountRole.WRITABLE }, // metadata account
                { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer }, // payer
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY }, // system program
                { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY }, // token program
                { address: TOKEN_METADATA_PROGRAM_ID, role: AccountRole.READONLY }, // token metadata program
            ],
            data: new Uint8Array(data),
        });

        const mintAccount = svm.getAccount(mint.address);
        if (!mintAccount?.exists) throw new Error('Mint account not found');
        assert.equal(mintAccount.programAddress, TOKEN_PROGRAM_ADDRESS);

        const metadataAccount = svm.getAccount(metadataAddress);
        if (!metadataAccount?.exists) throw new Error('Metadata account not found');
        assert.equal(metadataAccount.programAddress, TOKEN_METADATA_PROGRAM_ID);
        assert.isTrue(Buffer.from(metadataAccount.data).toString('utf-8').includes('Homer NFT'));

        const mintConfigAccount = svm.getAccount(mintConfigPda);
        if (!mintConfigAccount?.exists) throw new Error('Mint config PDA not found');
        assert.equal(mintConfigAccount.programAddress, programId);
    });

    it('Mint the NFT to your wallet!', async () => {
        const metadataAddress = await getMetadataAddress(mint.address);
        const editionAddress = await getMasterEditionAddress(mint.address);
        const [ata] = await findAssociatedTokenPda({
            owner: payer.address,
            mint: mint.address,
            tokenProgram: TOKEN_PROGRAM_ADDRESS,
        });

        await send({
            programAddress: programId,
            accounts: [
                { address: mint.address, role: AccountRole.WRITABLE }, // mint account
                { address: metadataAddress, role: AccountRole.WRITABLE }, // metadata account
                { address: editionAddress, role: AccountRole.WRITABLE }, // master edition account
                { address: mintAuthorityPda, role: AccountRole.READONLY }, // mint authority PDA
                { address: mintConfigPda, role: AccountRole.READONLY }, // mint config PDA
                { address: ata, role: AccountRole.WRITABLE }, // associated token account
                { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer }, // payer
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY }, // system program
                { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY }, // token program
                { address: ASSOCIATED_TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY }, // associated token program
                { address: TOKEN_METADATA_PROGRAM_ID, role: AccountRole.READONLY }, // token metadata program
            ],
            data: new Uint8Array([MINT]),
        });

        // The NFT (a single token) landed in the payer's associated token account.
        const ataAccount = svm.getAccount(ata);
        if (!ataAccount?.exists) throw new Error('Associated token account not found');
        // Decode the token account with the official codec instead of reading the
        // `amount` field from a raw byte offset by hand.
        const amount = getTokenDecoder().decode(ataAccount.data).amount;
        assert.equal(amount, 1n);

        // The master edition account exists and is owned by the Token Metadata
        // program — proof the CreateMasterEditionV3 CPI (signed by the PDA) succeeded.
        const editionAccount = svm.getAccount(editionAddress);
        if (!editionAccount?.exists) throw new Error('Master edition account not found');
        assert.equal(editionAccount.programAddress, TOKEN_METADATA_PROGRAM_ID);
    });

    it('rejects mint from a wallet that did not create the token', async () => {
        // A fresh mint is required: after the happy-path mint, Metaplex already holds
        // the mint authority via the master edition, so a second mint would fail even
        // without the admin check. This test must fail *only* because of that check.
        const otherMint = await generateKeyPairSigner();
        const [otherMintConfig] = await getProgramDerivedAddress({
            programAddress: programId,
            seeds: ['mint_config', addressEncoder.encode(otherMint.address)],
        });
        const otherMetadata = await getMetadataAddress(otherMint.address);
        const otherEdition = await getMasterEditionAddress(otherMint.address);

        const createData = createTokenArgsEncoder.encode({
            instruction: CREATE,
            nftTitle: 'Homer NFT',
            nftSymbol: 'HOMR',
            nftUri: 'https://raw.githubusercontent.com/solana-developers/program-examples/new-examples/tokens/tokens/.assets/nft.json',
        });

        await send({
            programAddress: programId,
            accounts: [
                { address: otherMint.address, role: AccountRole.WRITABLE_SIGNER, signer: otherMint },
                { address: mintAuthorityPda, role: AccountRole.READONLY },
                { address: otherMintConfig, role: AccountRole.WRITABLE },
                { address: otherMetadata, role: AccountRole.WRITABLE },
                { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
                { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
                { address: TOKEN_METADATA_PROGRAM_ID, role: AccountRole.READONLY },
            ],
            data: new Uint8Array(createData),
        });

        const outsider = await generateKeyPairSigner();
        svm.airdrop(outsider.address, lamports(10_000_000_000n));

        const [outsiderAta] = await findAssociatedTokenPda({
            owner: outsider.address,
            mint: otherMint.address,
            tokenProgram: TOKEN_PROGRAM_ADDRESS,
        });

        const result = svm.sendTransaction(
            await signTransactionMessageWithSigners(
                pipe(
                    createTransactionMessage({ version: 0 }),
                    m => setTransactionMessageFeePayerSigner(outsider, m),
                    m => svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
                    m =>
                        appendTransactionMessageInstruction(
                            {
                                programAddress: programId,
                                accounts: [
                                    { address: otherMint.address, role: AccountRole.WRITABLE },
                                    { address: otherMetadata, role: AccountRole.WRITABLE },
                                    { address: otherEdition, role: AccountRole.WRITABLE },
                                    { address: mintAuthorityPda, role: AccountRole.READONLY },
                                    { address: otherMintConfig, role: AccountRole.READONLY },
                                    { address: outsiderAta, role: AccountRole.WRITABLE },
                                    { address: outsider.address, role: AccountRole.WRITABLE_SIGNER, signer: outsider },
                                    { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
                                    { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
                                    { address: ASSOCIATED_TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
                                    { address: TOKEN_METADATA_PROGRAM_ID, role: AccountRole.READONLY },
                                ],
                                data: new Uint8Array([MINT]),
                            },
                            m,
                        ),
                ),
            ),
        );
        assert(result instanceof FailedTransactionMetadata, 'expected the transaction to fail');
    });
});
