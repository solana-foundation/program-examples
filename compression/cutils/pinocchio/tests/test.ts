import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import * as path from 'node:path';
import { keccak_256 } from '@noble/hashes/sha3';
import { getCreateAccountInstruction, SYSTEM_PROGRAM_ADDRESS } from '@solana-program/system';
import {
    findAssociatedTokenPda,
    getCreateAssociatedTokenInstruction,
    getInitializeMint2Instruction,
    getMintToInstruction,
    TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token';
import {
    AccountRole,
    address,
    appendTransactionMessageInstructions,
    createTransactionMessage,
    generateKeyPairSigner,
    getAddressDecoder,
    getAddressEncoder,
    getProgramDerivedAddress,
    lamports,
    pipe,
    setTransactionMessageFeePayerSigner,
    signTransactionMessageWithSigners,
} from '@solana/kit';
import { assert } from 'chai';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';

// None of these ship with LiteSVM or have an official @solana-program client, so
// their ids are hand-rolled and the .so files are dumped from mainnet into
// tests/fixtures by prepare.mjs. SPL Token and the Associated Token Account
// program are bundled with LiteSVM and come from @solana-program/token.
const MPL_BUBBLEGUM_PROGRAM_ID = address('BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY');
const SPL_ACCOUNT_COMPRESSION_PROGRAM_ID = address('cmtDvXumGCrqC1Age74AVPhSRVXJMd8PJS91L8KbNCK');
const SPL_NOOP_PROGRAM_ID = address('noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV');
const TOKEN_METADATA_PROGRAM_ID = address('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

const FIXTURES = path.join(process.cwd(), 'tests', 'fixtures');
const PROGRAM_SO = path.join(FIXTURES, 'cutils_pinocchio_program.so');
const BUBBLEGUM_SO = path.join(FIXTURES, 'mpl_bubblegum.so');
const ACCOUNT_COMPRESSION_SO = path.join(FIXTURES, 'spl_account_compression.so');
const NOOP_SO = path.join(FIXTURES, 'spl_noop.so');
const TOKEN_METADATA_SO = path.join(FIXTURES, 'token_metadata.so');

// Instruction discriminators of this program.
const MINT = 0;
const VERIFY = 1;

// Token Metadata instruction discriminators (the Borsh enum variant index).
const CREATE_METADATA_ACCOUNT_V3 = 33;
const CREATE_MASTER_EDITION_V3 = 17;

// The smallest valid (max_depth, max_buffer_size) pair the SPL Account
// Compression program accepts. The tree holds a single cNFT at index 0, which
// keeps the merkle proof to the three empty-node siblings on its path.
const MAX_DEPTH = 3;
const MAX_BUFFER_SIZE = 8;

// Layout of a concurrent merkle tree account, mirroring
// `getConcurrentMerkleTreeAccountSize` from @solana/spl-account-compression.
const HEADER_SIZE = 1 + 1 + 4 + 4 + 32 + 8 + 6;
const CHANGE_LOG_SIZE = 32 + 32 * MAX_DEPTH + 4 + 4;
const RIGHTMOST_PATH_SIZE = 32 * MAX_DEPTH + 32 + 4 + 4;
const TREE_ACCOUNT_SIZE = HEADER_SIZE + 8 + 8 + 8 + MAX_BUFFER_SIZE * CHANGE_LOG_SIZE + RIGHTMOST_PATH_SIZE;
const ACTIVE_INDEX_OFFSET = HEADER_SIZE + 8;
const CHANGE_LOGS_OFFSET = HEADER_SIZE + 8 + 8 + 8;

// The metadata the program stamps on every cNFT. Only the URI is a parameter;
// the rest is hardcoded in the program, so the test mirrors those constants to
// recompute the leaf hash.
const NAME = 'BURGER';
const SYMBOL = 'BURG';
const URI = 'https://arweave.net/nVRvZDaOk5YAdr4ZBEeMjOVhynuv8P3vywvuN5sYSPo';
const SELLER_FEE_BASIS_POINTS = 0;
const CREATOR_SHARE = 100;

type Address = ReturnType<typeof address>;
type Signer = Awaited<ReturnType<typeof generateKeyPairSigner>>;

const addressEncoder = getAddressEncoder();
const addressDecoder = getAddressDecoder();

function u16(value: number): Buffer {
    const buffer = Buffer.alloc(2);
    buffer.writeUInt16LE(value);
    return buffer;
}

function u32(value: number): Buffer {
    const buffer = Buffer.alloc(4);
    buffer.writeUInt32LE(value);
    return buffer;
}

function u64(value: bigint): Buffer {
    const buffer = Buffer.alloc(8);
    buffer.writeBigUInt64LE(value);
    return buffer;
}

/** Borsh serializes a string as its byte length (u32) followed by its bytes. */
function borshString(value: string): Buffer {
    const bytes = Buffer.from(value, 'utf8');
    return Buffer.concat([u32(bytes.length), bytes]);
}

/** Anchor's instruction discriminator: the first 8 bytes of `sha256("global:<name>")`. */
function anchorDiscriminator(name: string): Buffer {
    return createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
}

function encodeAddress(value: Address): Buffer {
    return Buffer.from(addressEncoder.encode(value));
}

/** Reinterprets a 32-byte merkle node as an address, which is how proofs are passed. */
function nodeToAddress(node: Uint8Array): Address {
    return addressDecoder.decode(node);
}

/**
 * `EMPTY_NODES[i]` is the root of a fully empty subtree of height `i`: an empty
 * leaf is 32 zero bytes and every level above it is the keccak of its two
 * (identical) children.
 */
const EMPTY_NODES: Uint8Array[] = [new Uint8Array(32)];
for (let level = 1; level <= MAX_DEPTH; level++) {
    EMPTY_NODES.push(keccak_256(Buffer.concat([EMPTY_NODES[level - 1], EMPTY_NODES[level - 1]])));
}

/** The tree holds one leaf at index 0, so its siblings are all empty nodes. */
const PROOF = EMPTY_NODES.slice(0, MAX_DEPTH);

/**
 * Borsh serialization of bubblegum's `MetadataArgs`, matching what the program
 * builds. `MintToCollectionV1` flips `collection.verified` to true before
 * hashing, so the hash below has to use the verified form.
 */
function serializeMetadataArgs(collectionMint: Address, creator: Address): Buffer {
    return Buffer.concat([
        borshString(NAME),
        borshString(SYMBOL),
        borshString(URI),
        u16(SELLER_FEE_BASIS_POINTS),
        Buffer.from([0]), // primary_sale_happened: false
        Buffer.from([0]), // is_mutable: false
        Buffer.from([1, 0]), // edition_nonce: Some(0)
        Buffer.from([1, 0]), // token_standard: Some(NonFungible)
        Buffer.from([1, 1]), // collection: Some({ verified: true, .. })
        encodeAddress(collectionMint),
        Buffer.from([0]), // uses: None
        Buffer.from([0]), // token_program_version: Original
        u32(1), // creators: one entry
        encodeAddress(creator),
        Buffer.from([0]), // creators[0].verified: false
        Buffer.from([CREATOR_SHARE]),
    ]);
}

/** Bubblegum hashes metadata as `keccak(keccak(args) || seller_fee_basis_points)`. */
function hashMetadata(collectionMint: Address, creator: Address): Uint8Array {
    return keccak_256(
        Buffer.concat([keccak_256(serializeMetadataArgs(collectionMint, creator)), u16(SELLER_FEE_BASIS_POINTS)]),
    );
}

/** Each creator contributes `address || verified || share` to the creator hash. */
function hashCreators(creator: Address): Uint8Array {
    return keccak_256(Buffer.concat([encodeAddress(creator), Buffer.from([0]), Buffer.from([CREATOR_SHARE])]));
}

/** The `LeafSchema::V1` hash that the tree actually stores. */
function hashLeaf(
    assetId: Address,
    owner: Address,
    delegate: Address,
    nonce: bigint,
    dataHash: Uint8Array,
    creatorHash: Uint8Array,
): Uint8Array {
    return keccak_256(
        Buffer.concat([
            Buffer.from([1]), // LeafSchema version V1
            encodeAddress(assetId),
            encodeAddress(owner),
            encodeAddress(delegate),
            u64(nonce),
            Buffer.from(dataHash),
            Buffer.from(creatorHash),
        ]),
    );
}

/** Root of a tree holding `leaf` at index 0 and nothing else. */
function rootWithSingleLeaf(leaf: Uint8Array): Uint8Array {
    let node = leaf;
    for (let level = 0; level < MAX_DEPTH; level++) {
        node = keccak_256(Buffer.concat([node, EMPTY_NODES[level]]));
    }
    return node;
}

describe('Compressed NFT Utils (Pinocchio)', () => {
    let svm: LiteSVM;
    let programId: Address;
    let payer: Signer;
    let leafOwner: Signer;
    let merkleTree: Signer;
    let treeAuthority: Address;
    let assetId: Address;
    let bubblegumSigner: Address;
    let collectionMint: Signer;
    let collectionMetadata: Address;
    let collectionEdition: Address;
    let dataHash: Uint8Array;
    let creatorHash: Uint8Array;

    before(async () => {
        svm = new LiteSVM();
        programId = (await generateKeyPairSigner()).address;
        svm.addProgramFromFile(programId, PROGRAM_SO);
        svm.addProgramFromFile(MPL_BUBBLEGUM_PROGRAM_ID, BUBBLEGUM_SO);
        svm.addProgramFromFile(SPL_ACCOUNT_COMPRESSION_PROGRAM_ID, ACCOUNT_COMPRESSION_SO);
        svm.addProgramFromFile(SPL_NOOP_PROGRAM_ID, NOOP_SO);
        svm.addProgramFromFile(TOKEN_METADATA_PROGRAM_ID, TOKEN_METADATA_SO);

        payer = await generateKeyPairSigner();
        svm.airdrop(payer.address, lamports(100_000_000_000n));
        leafOwner = await generateKeyPairSigner();
        svm.airdrop(leafOwner.address, lamports(1_000_000_000n));

        [bubblegumSigner] = await getProgramDerivedAddress({
            programAddress: MPL_BUBBLEGUM_PROGRAM_ID,
            seeds: ['collection_cpi'],
        });

        await createCollection();
        await createTree();

        // The payer is both the collection authority and the sole creator, so
        // these are the hashes the program's metadata produces.
        dataHash = hashMetadata(collectionMint.address, payer.address);
        creatorHash = hashCreators(payer.address);
    });

    async function send<TInstruction extends Parameters<typeof appendTransactionMessageInstructions>[0][number]>(
        instructions: TInstruction[],
        extraSigners: Signer[] = [],
    ) {
        const transactionMessage = pipe(
            createTransactionMessage({ version: 0 }),
            m => setTransactionMessageFeePayerSigner(payer, m),
            m => svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
            m => appendTransactionMessageInstructions(instructions, m),
        );
        const signedTx = await signTransactionMessageWithSigners(transactionMessage);
        const result = svm.sendTransaction(signedTx);
        if (result instanceof FailedTransactionMetadata) {
            throw new Error(`Transaction failed: ${result.err()}\n${result.meta().logs().join('\n')}`);
        }
        return result;
    }

    /** Sends instructions expected to fail, returning the error and logs. */
    async function sendExpectingFailure<
        TInstruction extends Parameters<typeof appendTransactionMessageInstructions>[0][number],
    >(instructions: TInstruction[]): Promise<string> {
        // The compression program aborts rather than returning a program error on
        // a bad proof, so assertions match on the logs as well as the error.
        const transactionMessage = pipe(
            createTransactionMessage({ version: 0 }),
            m => setTransactionMessageFeePayerSigner(payer, m),
            m => svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
            m => appendTransactionMessageInstructions(instructions, m),
        );
        const signedTx = await signTransactionMessageWithSigners(transactionMessage);
        const result = svm.sendTransaction(signedTx);
        if (!(result instanceof FailedTransactionMetadata)) {
            throw new Error('expected the transaction to fail');
        }
        return `${result.err()}\n${result.meta().logs().join('\n')}`;
    }

    /** Reads the tree's current root out of its active change log. */
    function currentRoot(): Uint8Array {
        const account = svm.getAccount(merkleTree.address);
        if (!account.exists) {
            throw new Error('merkle tree account should exist');
        }
        const data = Buffer.from(account.data);
        const activeIndex = Number(data.readBigUInt64LE(ACTIVE_INDEX_OFFSET));
        const offset = CHANGE_LOGS_OFFSET + activeIndex * CHANGE_LOG_SIZE;
        return new Uint8Array(data.subarray(offset, offset + 32));
    }

    /** Mints the collection NFT and gives it metadata and a master edition. */
    async function createCollection() {
        collectionMint = await generateKeyPairSigner();
        [collectionMetadata] = await getProgramDerivedAddress({
            programAddress: TOKEN_METADATA_PROGRAM_ID,
            seeds: [
                'metadata',
                addressEncoder.encode(TOKEN_METADATA_PROGRAM_ID),
                addressEncoder.encode(collectionMint.address),
            ],
        });
        [collectionEdition] = await getProgramDerivedAddress({
            programAddress: TOKEN_METADATA_PROGRAM_ID,
            seeds: [
                'metadata',
                addressEncoder.encode(TOKEN_METADATA_PROGRAM_ID),
                addressEncoder.encode(collectionMint.address),
                'edition',
            ],
        });
        const [ata] = await findAssociatedTokenPda({
            owner: payer.address,
            mint: collectionMint.address,
            tokenProgram: TOKEN_PROGRAM_ADDRESS,
        });

        const createMintAccount = getCreateAccountInstruction({
            payer,
            newAccount: collectionMint,
            lamports: svm.minimumBalanceForRentExemption(82n),
            space: 82n,
            programAddress: TOKEN_PROGRAM_ADDRESS,
        });
        const initializeMint = getInitializeMint2Instruction({
            mint: collectionMint.address,
            decimals: 0,
            mintAuthority: payer.address,
            freezeAuthority: payer.address,
        });
        const createAta = getCreateAssociatedTokenInstruction({
            payer,
            ata,
            owner: payer.address,
            mint: collectionMint.address,
        });
        const mintOne = getMintToInstruction({
            mint: collectionMint.address,
            token: ata,
            mintAuthority: payer,
            amount: 1n,
        });

        // `CreateMetadataAccountV3` takes a `DataV2` followed by `is_mutable` and
        // an optional `collection_details`; sizing the collection makes this mint
        // a collection parent rather than a plain NFT.
        const createMetadata = {
            programAddress: TOKEN_METADATA_PROGRAM_ID,
            accounts: [
                { address: collectionMetadata, role: AccountRole.WRITABLE },
                { address: collectionMint.address, role: AccountRole.READONLY },
                { address: payer.address, role: AccountRole.READONLY_SIGNER, signer: payer }, // mint authority
                { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer }, // payer
                { address: payer.address, role: AccountRole.READONLY }, // update authority
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ],
            data: new Uint8Array(
                Buffer.concat([
                    Buffer.from([CREATE_METADATA_ACCOUNT_V3]),
                    borshString('Super Sweet NFT Collection'),
                    borshString('SSNC'),
                    borshString('https://supersweetcollection.notarealurl/collection.json'),
                    u16(0), // seller_fee_basis_points
                    Buffer.from([0]), // creators: None
                    Buffer.from([0]), // collection: None
                    Buffer.from([0]), // uses: None
                    Buffer.from([1]), // is_mutable: true
                    Buffer.from([1, 0]), // collection_details: Some(V1 { size: 0 })
                    u64(0n),
                ]),
            ),
        };

        const createMasterEdition = {
            programAddress: TOKEN_METADATA_PROGRAM_ID,
            accounts: [
                { address: collectionEdition, role: AccountRole.WRITABLE },
                { address: collectionMint.address, role: AccountRole.WRITABLE },
                { address: payer.address, role: AccountRole.READONLY_SIGNER, signer: payer }, // update authority
                { address: payer.address, role: AccountRole.READONLY_SIGNER, signer: payer }, // mint authority
                { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer }, // payer
                { address: collectionMetadata, role: AccountRole.WRITABLE },
                { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ],
            data: new Uint8Array(
                Buffer.concat([
                    Buffer.from([CREATE_MASTER_EDITION_V3]),
                    Buffer.from([1]), // max_supply: Some(0)
                    u64(0n),
                ]),
            ),
        };

        await send([createMintAccount, initializeMint, createAta, mintOne, createMetadata, createMasterEdition]);
    }

    /** Allocates and initializes the merkle tree the cNFTs are minted into. */
    async function createTree() {
        merkleTree = await generateKeyPairSigner();
        [treeAuthority] = await getProgramDerivedAddress({
            programAddress: MPL_BUBBLEGUM_PROGRAM_ID,
            seeds: [addressEncoder.encode(merkleTree.address)],
        });
        [assetId] = await getProgramDerivedAddress({
            programAddress: MPL_BUBBLEGUM_PROGRAM_ID,
            seeds: ['asset', addressEncoder.encode(merkleTree.address), u64(0n)],
        });

        const createAccount = getCreateAccountInstruction({
            payer,
            newAccount: merkleTree,
            lamports: svm.minimumBalanceForRentExemption(BigInt(TREE_ACCOUNT_SIZE)),
            space: BigInt(TREE_ACCOUNT_SIZE),
            programAddress: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
        });

        const createTreeIx = {
            programAddress: MPL_BUBBLEGUM_PROGRAM_ID,
            accounts: [
                { address: treeAuthority, role: AccountRole.WRITABLE },
                { address: merkleTree.address, role: AccountRole.WRITABLE },
                { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer }, // payer
                { address: payer.address, role: AccountRole.READONLY_SIGNER, signer: payer }, // tree creator
                { address: SPL_NOOP_PROGRAM_ID, role: AccountRole.READONLY },
                { address: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID, role: AccountRole.READONLY },
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ],
            data: new Uint8Array(
                Buffer.concat([
                    anchorDiscriminator('create_tree'),
                    u32(MAX_DEPTH),
                    u32(MAX_BUFFER_SIZE),
                    Buffer.from([0]),
                ]),
            ),
        };

        await send([createAccount, createTreeIx]);
    }

    /** This program's `Mint` instruction, which CPIs into `MintToCollectionV1`. */
    function mintInstruction(uri: string = URI) {
        return {
            programAddress: programId,
            accounts: [
                { address: treeAuthority, role: AccountRole.WRITABLE },
                { address: leafOwner.address, role: AccountRole.READONLY },
                { address: leafOwner.address, role: AccountRole.READONLY }, // leaf delegate
                { address: merkleTree.address, role: AccountRole.WRITABLE },
                { address: payer.address, role: AccountRole.READONLY_SIGNER, signer: payer },
                { address: payer.address, role: AccountRole.READONLY_SIGNER, signer: payer }, // tree delegate
                { address: payer.address, role: AccountRole.READONLY_SIGNER, signer: payer }, // collection authority
                // No collection authority record exists, so bubblegum expects its
                // own program id in that slot.
                { address: MPL_BUBBLEGUM_PROGRAM_ID, role: AccountRole.READONLY },
                { address: collectionMint.address, role: AccountRole.READONLY },
                { address: collectionMetadata, role: AccountRole.WRITABLE },
                { address: collectionEdition, role: AccountRole.READONLY },
                { address: bubblegumSigner, role: AccountRole.READONLY },
                { address: SPL_NOOP_PROGRAM_ID, role: AccountRole.READONLY },
                { address: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID, role: AccountRole.READONLY },
                { address: TOKEN_METADATA_PROGRAM_ID, role: AccountRole.READONLY },
                { address: MPL_BUBBLEGUM_PROGRAM_ID, role: AccountRole.READONLY },
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ],
            data: new Uint8Array(Buffer.concat([Buffer.from([MINT]), Buffer.from(uri, 'utf8')])),
        };
    }

    /** This program's `Verify` instruction, which CPIs into `verify_leaf`. */
    function verifyInstruction(root: Uint8Array, proof: Uint8Array[], owner: Signer = leafOwner) {
        return {
            programAddress: programId,
            accounts: [
                { address: owner.address, role: AccountRole.READONLY_SIGNER, signer: owner },
                { address: leafOwner.address, role: AccountRole.READONLY }, // leaf delegate
                { address: merkleTree.address, role: AccountRole.READONLY },
                { address: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID, role: AccountRole.READONLY },
                ...proof.map(node => ({ address: nodeToAddress(node), role: AccountRole.READONLY })),
            ],
            data: new Uint8Array(
                Buffer.concat([
                    Buffer.from([VERIFY]),
                    Buffer.from(root),
                    Buffer.from(dataHash),
                    Buffer.from(creatorHash),
                    u64(0n), // nonce
                    u32(0), // index
                ]),
            ),
        };
    }

    it('Mints a compressed NFT into the collection', async () => {
        await send([mintInstruction()]);

        // Recomputing the root locally proves the leaf hash — and with it the
        // data and creator hashes the verify below depends on — matches what
        // bubblegum stored.
        const leaf = hashLeaf(assetId, leafOwner.address, leafOwner.address, 0n, dataHash, creatorHash);
        assert.deepEqual(currentRoot(), rootWithSingleLeaf(leaf), 'the minted leaf should be in the tree');
    });

    it('Verifies the compressed NFT belongs to the tree', async () => {
        await send([verifyInstruction(currentRoot(), PROOF)]);
    });

    it('Rejects a proof that does not lead to the root', async () => {
        // Corrupting one sibling makes the recomputed root differ from the one
        // stored in the tree, which is exactly what verify_leaf checks.
        const wrongProof = PROOF.map(node => new Uint8Array(node));
        wrongProof[0][0] ^= 0xff;

        const error = await sendExpectingFailure([verifyInstruction(currentRoot(), wrongProof)]);
        assert.include(error, 'Invalid root recomputed from proof', `unexpected error: ${error}`);
    });

    it('Rejects a verify by someone who does not own the leaf', async () => {
        const stranger = await generateKeyPairSigner();
        svm.airdrop(stranger.address, lamports(1_000_000_000n));

        // The owner goes into the leaf hash, so a different signer rebuilds a
        // different leaf and the recomputed root stops matching the tree's.
        const error = await sendExpectingFailure([verifyInstruction(currentRoot(), PROOF, stranger)]);
        assert.include(error, 'Invalid root recomputed from proof', `unexpected error: ${error}`);
    });

    it('Rejects a verify the leaf owner did not sign', async () => {
        // This one never reaches the CPI: the program requires the leaf owner's
        // signature before it rebuilds the hash.
        const unsigned = verifyInstruction(currentRoot(), PROOF);
        unsigned.accounts[0] = { address: leafOwner.address, role: AccountRole.READONLY };

        const error = await sendExpectingFailure([unsigned]);
        assert.include(error, 'MissingRequiredSignature', `unexpected error: ${error}`);
    });

    it('Rejects an empty URI', async () => {
        const error = await sendExpectingFailure([mintInstruction('')]);
        assert.include(error, 'InvalidInstructionData', `unexpected error: ${error}`);
    });
});
