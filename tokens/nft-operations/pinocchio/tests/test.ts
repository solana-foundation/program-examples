import { Buffer } from 'node:buffer';
import * as path from 'node:path';
import {
    AccountRole,
    address,
    appendTransactionMessageInstruction,
    createTransactionMessage,
    generateKeyPairSigner,
    getAddressEncoder,
    getProgramDerivedAddress,
    lamports,
    pipe,
    setTransactionMessageFeePayerSigner,
    signTransactionMessageWithSigners,
} from '@solana/kit';
import { SYSVAR_INSTRUCTIONS_ADDRESS } from '@solana/sysvars';
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
// LiteSVM's standard runtime, and their ids (and the instructions sysvar) come
// from the official @solana-program/token and @solana/sysvars packages. The
// Metaplex Token Metadata program is not bundled and has no official
// @solana-program client, so its id stays hand-rolled and it is dumped from
// mainnet into tests/fixtures by prepare.mjs.
const TOKEN_METADATA_PROGRAM_ID = address('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

// Instruction discriminators (the Borsh enum variant index).
const CREATE_COLLECTION = 0;
const MINT_NFT = 1;
const VERIFY_COLLECTION = 2;

// The compiled program artifacts live in ./fixtures: the pinocchio program is
// built there by `build-and-test`, and token_metadata.so is dumped from mainnet
// by prepare.mjs. The npm scripts always run from the package root.
const FIXTURES = path.join(process.cwd(), 'tests', 'fixtures');
const PROGRAM_SO = path.join(FIXTURES, 'nft_operations_pinocchio_program.so');
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

async function getAssociatedTokenAddress(mint: ReturnType<typeof address>, owner: ReturnType<typeof address>) {
    const [ata] = await findAssociatedTokenPda({ owner, mint, tokenProgram: TOKEN_PROGRAM_ADDRESS });
    return ata;
}

async function getCollectionAuthorityAddress(
    programAddress: ReturnType<typeof address>,
    mint: ReturnType<typeof address>,
) {
    const [pda] = await getProgramDerivedAddress({
        programAddress,
        seeds: ['collection_authority', addressEncoder.encode(mint)],
    });
    return pda;
}

describe('NFT Operations (Pinocchio)', () => {
    let svm: LiteSVM;
    let programId: ReturnType<typeof address>;
    let payer: Awaited<ReturnType<typeof generateKeyPairSigner>>;
    let collectionMint: Awaited<ReturnType<typeof generateKeyPairSigner>>;
    let nftMint: Awaited<ReturnType<typeof generateKeyPairSigner>>;
    let mintAuthorityPda: ReturnType<typeof address>;

    before(async () => {
        svm = new LiteSVM();
        // The program never asserts its own id, so any address works; a generated
        // one keeps the test self-contained.
        programId = (await generateKeyPairSigner()).address;
        svm.addProgramFromFile(programId, PROGRAM_SO);
        svm.addProgramFromFile(TOKEN_METADATA_PROGRAM_ID, TOKEN_METADATA_SO);

        payer = await generateKeyPairSigner();
        svm.airdrop(payer.address, lamports(10_000_000_000n));
        // The collection and NFT mints are created across the suite's tests, so they
        // are generated once here.
        collectionMint = await generateKeyPairSigner();
        nftMint = await generateKeyPairSigner();

        // The update/mint authority is a PDA of the program; the program derives
        // its canonical bump on-chain to sign CPIs, so only the address is needed.
        const [pda] = await getProgramDerivedAddress({
            programAddress: programId,
            seeds: ['authority'],
        });
        mintAuthorityPda = pda;
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

    it('Creates a collection NFT', async () => {
        const metadata = await getMetadataAddress(collectionMint.address);
        const masterEdition = await getMasterEditionAddress(collectionMint.address);
        const destination = await getAssociatedTokenAddress(collectionMint.address, payer.address);
        const collectionAuthority = await getCollectionAuthorityAddress(programId, collectionMint.address);

        await send({
            programAddress: programId,
            accounts: [
                { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer }, // user
                { address: collectionMint.address, role: AccountRole.WRITABLE_SIGNER, signer: collectionMint }, // mint
                { address: mintAuthorityPda, role: AccountRole.READONLY }, // mint authority PDA
                { address: collectionAuthority, role: AccountRole.WRITABLE }, // collection authority PDA
                { address: metadata, role: AccountRole.WRITABLE }, // metadata
                { address: masterEdition, role: AccountRole.WRITABLE }, // master edition
                { address: destination, role: AccountRole.WRITABLE }, // destination ATA
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY }, // system program
                { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY }, // token program
                { address: ASSOCIATED_TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY }, // associated token program
                { address: TOKEN_METADATA_PROGRAM_ID, role: AccountRole.READONLY }, // token metadata program
            ],
            data: new Uint8Array([CREATE_COLLECTION]),
        });

        const mintAccount = svm.getAccount(collectionMint.address);
        if (!mintAccount?.exists) throw new Error('Collection mint not found');
        assert.equal(mintAccount.programAddress, TOKEN_PROGRAM_ADDRESS);

        const destinationAccount = svm.getAccount(destination);
        if (!destinationAccount?.exists) throw new Error('Collection token account not found');
        assert.equal(getTokenDecoder().decode(destinationAccount.data).amount, 1n);

        const metadataAccount = svm.getAccount(metadata);
        if (!metadataAccount?.exists) throw new Error('Collection metadata not found');
        assert.equal(metadataAccount.programAddress, TOKEN_METADATA_PROGRAM_ID);
        assert.isTrue(Buffer.from(metadataAccount.data).toString('utf-8').includes('DummyCollection'));
    });

    it('Mints an NFT into the collection', async () => {
        const metadata = await getMetadataAddress(nftMint.address);
        const masterEdition = await getMasterEditionAddress(nftMint.address);
        const destination = await getAssociatedTokenAddress(nftMint.address, payer.address);

        await send({
            programAddress: programId,
            accounts: [
                { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer }, // owner
                { address: nftMint.address, role: AccountRole.WRITABLE_SIGNER, signer: nftMint }, // mint
                { address: mintAuthorityPda, role: AccountRole.READONLY }, // mint authority PDA
                { address: metadata, role: AccountRole.WRITABLE }, // metadata
                { address: masterEdition, role: AccountRole.WRITABLE }, // master edition
                { address: destination, role: AccountRole.WRITABLE }, // destination ATA
                { address: collectionMint.address, role: AccountRole.READONLY }, // collection mint
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY }, // system program
                { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY }, // token program
                { address: ASSOCIATED_TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY }, // associated token program
                { address: TOKEN_METADATA_PROGRAM_ID, role: AccountRole.READONLY }, // token metadata program
            ],
            data: new Uint8Array([MINT_NFT]),
        });

        const destinationAccount = svm.getAccount(destination);
        if (!destinationAccount?.exists) throw new Error('NFT token account not found');
        assert.equal(getTokenDecoder().decode(destinationAccount.data).amount, 1n);

        const metadataAccount = svm.getAccount(metadata);
        if (!metadataAccount?.exists) throw new Error('NFT metadata not found');
        assert.equal(metadataAccount.programAddress, TOKEN_METADATA_PROGRAM_ID);
        assert.isTrue(Buffer.from(metadataAccount.data).toString('utf-8').includes('Mint Test'));

        const editionAccount = svm.getAccount(masterEdition);
        if (!editionAccount?.exists) throw new Error('NFT master edition not found');
        assert.equal(editionAccount.programAddress, TOKEN_METADATA_PROGRAM_ID);
    });

    it('rejects verify_collection from a wallet that did not create the collection', async () => {
        const metadata = await getMetadataAddress(nftMint.address);
        const collectionMetadata = await getMetadataAddress(collectionMint.address);
        const collectionMasterEdition = await getMasterEditionAddress(collectionMint.address);
        const collectionAuthority = await getCollectionAuthorityAddress(programId, collectionMint.address);

        const attacker = await generateKeyPairSigner();
        svm.airdrop(attacker.address, lamports(10_000_000_000n));

        const transactionMessage = pipe(
            createTransactionMessage({ version: 0 }),
            m => setTransactionMessageFeePayerSigner(attacker, m),
            m => svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
            m =>
                appendTransactionMessageInstruction(
                    {
                        programAddress: programId,
                        accounts: [
                            { address: attacker.address, role: AccountRole.WRITABLE_SIGNER, signer: attacker }, // payer
                            { address: mintAuthorityPda, role: AccountRole.READONLY }, // mint authority PDA
                            { address: collectionAuthority, role: AccountRole.READONLY }, // collection authority PDA
                            { address: metadata, role: AccountRole.WRITABLE }, // NFT metadata
                            { address: collectionMint.address, role: AccountRole.READONLY }, // collection mint
                            { address: collectionMetadata, role: AccountRole.WRITABLE }, // collection metadata
                            { address: collectionMasterEdition, role: AccountRole.READONLY }, // collection master edition
                            { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY }, // system program
                            { address: SYSVAR_INSTRUCTIONS_ADDRESS, role: AccountRole.READONLY }, // instructions sysvar
                            { address: TOKEN_METADATA_PROGRAM_ID, role: AccountRole.READONLY }, // token metadata program
                        ],
                        data: new Uint8Array([VERIFY_COLLECTION]),
                    },
                    m,
                ),
        );
        const signedTx = await signTransactionMessageWithSigners(transactionMessage);
        const result = svm.sendTransaction(signedTx);

        assert.instanceOf(result, FailedTransactionMetadata, 'expected the attacker verify to fail');
        const failure = result as FailedTransactionMetadata;
        // Assert the specific Unauthorized rejection (NftOperationsError::Unauthorized = 1),
        // not just "it failed" — both the custom error code and the on-chain log it pairs
        // with, so a coincidental, unrelated failure wouldn't false-pass this test.
        assert.include(
            failure.err().toString(),
            'InstructionErrorCustom { code: 1 }',
            `expected NftOperationsError::Unauthorized (code 1), got: ${failure.err().toString()}`,
        );
        assert.include(
            failure.meta().logs().join('\n'),
            "Unauthorized: signer is not the collection's original creator",
        );
    });

    it('Verifies the NFT as part of the collection', async () => {
        const metadata = await getMetadataAddress(nftMint.address);
        const collectionMetadata = await getMetadataAddress(collectionMint.address);
        const collectionMasterEdition = await getMasterEditionAddress(collectionMint.address);
        const collectionAuthority = await getCollectionAuthorityAddress(programId, collectionMint.address);

        // Metaplex `Verify` performs strict checks: the signer must be the
        // collection's update authority (our PDA), the collection metadata and
        // master edition must be valid, and the NFT must reference the collection.
        // A successful transaction therefore proves the whole flow is correct —
        // combined with the negative test above, which proves an unrelated
        // caller cannot trigger that same signature.
        await send({
            programAddress: programId,
            accounts: [
                { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer }, // payer
                { address: mintAuthorityPda, role: AccountRole.READONLY }, // mint authority PDA
                { address: collectionAuthority, role: AccountRole.READONLY }, // collection authority PDA
                { address: metadata, role: AccountRole.WRITABLE }, // NFT metadata
                { address: collectionMint.address, role: AccountRole.READONLY }, // collection mint
                { address: collectionMetadata, role: AccountRole.WRITABLE }, // collection metadata
                { address: collectionMasterEdition, role: AccountRole.READONLY }, // collection master edition
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY }, // system program
                { address: SYSVAR_INSTRUCTIONS_ADDRESS, role: AccountRole.READONLY }, // instructions sysvar
                { address: TOKEN_METADATA_PROGRAM_ID, role: AccountRole.READONLY }, // token metadata program
            ],
            data: new Uint8Array([VERIFY_COLLECTION]),
        });

        const metadataAccount = svm.getAccount(metadata);
        if (!metadataAccount?.exists) throw new Error('NFT metadata not found');
        assert.equal(metadataAccount.programAddress, TOKEN_METADATA_PROGRAM_ID);
    });
});
