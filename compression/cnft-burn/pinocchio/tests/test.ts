import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import * as path from 'node:path';
import { keccak_256 } from '@noble/hashes/sha3';
import { SYSTEM_PROGRAM_ADDRESS, getCreateAccountInstruction } from '@solana-program/system';
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

// None of the three programs a compressed NFT touches ship with LiteSVM or have
// an official @solana-program client, so their ids are hand-rolled and the .so
// files are dumped from mainnet into tests/fixtures by prepare.mjs.
const MPL_BUBBLEGUM_PROGRAM_ID = address('BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY');
const SPL_ACCOUNT_COMPRESSION_PROGRAM_ID = address('cmtDvXumGCrqC1Age74AVPhSRVXJMd8PJS91L8KbNCK');
const SPL_NOOP_PROGRAM_ID = address('noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV');

const FIXTURES = path.join(process.cwd(), 'tests', 'fixtures');
const PROGRAM_SO = path.join(FIXTURES, 'cnft_burn_pinocchio_program.so');
const BUBBLEGUM_SO = path.join(FIXTURES, 'mpl_bubblegum.so');
const ACCOUNT_COMPRESSION_SO = path.join(FIXTURES, 'spl_account_compression.so');
const NOOP_SO = path.join(FIXTURES, 'spl_noop.so');

// The smallest valid (max_depth, max_buffer_size) pair the SPL Account
// Compression program accepts. A depth of 3 keeps the merkle proof to three
// nodes, which is all this example needs to demonstrate a burn.
const MAX_DEPTH = 3;
const MAX_BUFFER_SIZE = 8;

// Layout of a concurrent merkle tree account, mirroring
// `getConcurrentMerkleTreeAccountSize` from @solana/spl-account-compression:
//
//   header         = account type (1) + header version (1) + max_buffer_size (4)
//                    + max_depth (4) + authority (32) + creation_slot (8) + padding (6)
//   tree           = sequence_number (8) + active_index (8) + buffer_size (8)
//                    + max_buffer_size change logs + the rightmost path
//   change log     = root (32) + path (32 * max_depth) + index (4) + padding (4)
//   rightmost path = proof (32 * max_depth) + leaf (32) + index (4) + padding (4)
const HEADER_SIZE = 1 + 1 + 4 + 4 + 32 + 8 + 6;
const CHANGE_LOG_SIZE = 32 + 32 * MAX_DEPTH + 4 + 4;
const RIGHTMOST_PATH_SIZE = 32 * MAX_DEPTH + 32 + 4 + 4;
const TREE_ACCOUNT_SIZE = HEADER_SIZE + 8 + 8 + 8 + MAX_BUFFER_SIZE * CHANGE_LOG_SIZE + RIGHTMOST_PATH_SIZE;
const ACTIVE_INDEX_OFFSET = HEADER_SIZE + 8;
const CHANGE_LOGS_OFFSET = HEADER_SIZE + 8 + 8 + 8;

// The metadata minted onto the leaf. Leaving `creators` empty is deliberate: it
// makes the creator hash a constant (the keccak of no input) and keeps the
// metadata serialization below short.
const METADATA = {
    name: 'Compressed NFT',
    symbol: 'cNFT',
    uri: 'https://example.com/cnft.json',
    sellerFeeBasisPoints: 0,
};

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

function encodeAddress(value: ReturnType<typeof address>): Buffer {
    return Buffer.from(addressEncoder.encode(value));
}

/** Reinterprets a 32-byte merkle node as an address, which is how proofs are passed. */
function nodeToAddress(node: Uint8Array): ReturnType<typeof address> {
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

/** Borsh serialization of bubblegum's `MetadataArgs`. */
function serializeMetadataArgs(): Buffer {
    return Buffer.concat([
        borshString(METADATA.name),
        borshString(METADATA.symbol),
        borshString(METADATA.uri),
        u16(METADATA.sellerFeeBasisPoints),
        Buffer.from([0]), // primary_sale_happened: false
        Buffer.from([1]), // is_mutable: true
        Buffer.from([0]), // edition_nonce: None
        Buffer.from([1, 0]), // token_standard: Some(NonFungible) — the only one bubblegum mints
        Buffer.from([0]), // collection: None
        Buffer.from([0]), // uses: None
        Buffer.from([0]), // token_program_version: Original
        u32(0), // creators: []
    ]);
}

/** Bubblegum hashes metadata as `keccak(keccak(args) || seller_fee_basis_points)`. */
function hashMetadata(): Uint8Array {
    const argsHash = keccak_256(serializeMetadataArgs());
    return keccak_256(Buffer.concat([argsHash, u16(METADATA.sellerFeeBasisPoints)]));
}

/** With no creators the creator hash is just the keccak of an empty input. */
function hashCreators(): Uint8Array {
    return keccak_256(new Uint8Array(0));
}

/** The `LeafSchema::V1` hash that the tree actually stores. */
function hashLeaf(args: {
    assetId: ReturnType<typeof address>;
    owner: ReturnType<typeof address>;
    delegate: ReturnType<typeof address>;
    nonce: bigint;
    dataHash: Uint8Array;
    creatorHash: Uint8Array;
}): Uint8Array {
    return keccak_256(
        Buffer.concat([
            Buffer.from([1]), // LeafSchema version V1
            encodeAddress(args.assetId),
            encodeAddress(args.owner),
            encodeAddress(args.delegate),
            u64(args.nonce),
            Buffer.from(args.dataHash),
            Buffer.from(args.creatorHash),
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

describe('Compressed NFT Burn (Pinocchio)', () => {
    let svm: LiteSVM;
    let programId: ReturnType<typeof address>;
    let payer: Awaited<ReturnType<typeof generateKeyPairSigner>>;
    let merkleTree: Awaited<ReturnType<typeof generateKeyPairSigner>>;
    let treeAuthority: ReturnType<typeof address>;
    let assetId: ReturnType<typeof address>;

    const dataHash = hashMetadata();
    const creatorHash = hashCreators();

    before(async () => {
        svm = new LiteSVM();
        // The program never asserts its own id, so any address works; a generated
        // one keeps the test self-contained.
        programId = (await generateKeyPairSigner()).address;
        svm.addProgramFromFile(programId, PROGRAM_SO);
        svm.addProgramFromFile(MPL_BUBBLEGUM_PROGRAM_ID, BUBBLEGUM_SO);
        svm.addProgramFromFile(SPL_ACCOUNT_COMPRESSION_PROGRAM_ID, ACCOUNT_COMPRESSION_SO);
        svm.addProgramFromFile(SPL_NOOP_PROGRAM_ID, NOOP_SO);

        payer = await generateKeyPairSigner();
        svm.airdrop(payer.address, lamports(10_000_000_000n));
        merkleTree = await generateKeyPairSigner();

        // Bubblegum owns one authority PDA per tree, derived from the tree itself.
        [treeAuthority] = await getProgramDerivedAddress({
            programAddress: MPL_BUBBLEGUM_PROGRAM_ID,
            seeds: [addressEncoder.encode(merkleTree.address)],
        });
        // A cNFT's asset id is derived from its tree and the leaf's nonce.
        [assetId] = await getProgramDerivedAddress({
            programAddress: MPL_BUBBLEGUM_PROGRAM_ID,
            seeds: ['asset', addressEncoder.encode(merkleTree.address), u64(0n)],
        });
    });

    async function send<TInstruction extends Parameters<typeof appendTransactionMessageInstructions>[0][number]>(
        instructions: TInstruction[],
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

    it('Creates a merkle tree', async () => {
        // The tree account is allocated by the system program and handed to the
        // compression program, which initializes it during `create_tree`.
        const createAccount = getCreateAccountInstruction({
            payer,
            newAccount: merkleTree,
            lamports: svm.minimumBalanceForRentExemption(BigInt(TREE_ACCOUNT_SIZE)),
            space: BigInt(TREE_ACCOUNT_SIZE),
            programAddress: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
        });

        const createTree = {
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
                    Buffer.from([0]), // public: None
                ]),
            ),
        };

        await send([createAccount, createTree]);

        // An untouched tree's root is the root of a fully empty tree.
        assert.deepEqual(currentRoot(), EMPTY_NODES[MAX_DEPTH], 'a new tree should be empty');
    });

    it('Mints a compressed NFT into the tree', async () => {
        const mint = {
            programAddress: MPL_BUBBLEGUM_PROGRAM_ID,
            accounts: [
                { address: treeAuthority, role: AccountRole.WRITABLE },
                { address: payer.address, role: AccountRole.READONLY }, // leaf owner
                { address: payer.address, role: AccountRole.READONLY }, // leaf delegate
                { address: merkleTree.address, role: AccountRole.WRITABLE },
                { address: payer.address, role: AccountRole.READONLY_SIGNER, signer: payer }, // payer
                { address: payer.address, role: AccountRole.READONLY_SIGNER, signer: payer }, // tree delegate
                { address: SPL_NOOP_PROGRAM_ID, role: AccountRole.READONLY },
                { address: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID, role: AccountRole.READONLY },
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ],
            data: new Uint8Array(Buffer.concat([anchorDiscriminator('mint_v1'), serializeMetadataArgs()])),
        };

        await send([mint]);

        // Recomputing the root locally proves the leaf hash — and with it the data
        // and creator hashes the burn depends on — matches what bubblegum stored.
        const expectedLeaf = hashLeaf({
            assetId,
            owner: payer.address,
            delegate: payer.address,
            nonce: 0n,
            dataHash,
            creatorHash,
        });
        assert.deepEqual(
            currentRoot(),
            rootWithSingleLeaf(expectedLeaf),
            'locally computed leaf should match the tree',
        );
    });

    it('Burns the compressed NFT', async () => {
        // Only leaf 0 is populated, so every sibling on its path is an empty node.
        const proof = EMPTY_NODES.slice(0, MAX_DEPTH);

        const burn = {
            programAddress: programId,
            accounts: [
                { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer }, // leaf owner
                { address: treeAuthority, role: AccountRole.READONLY }, // tree authority
                { address: merkleTree.address, role: AccountRole.WRITABLE }, // merkle tree
                { address: SPL_NOOP_PROGRAM_ID, role: AccountRole.READONLY }, // log wrapper
                { address: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID, role: AccountRole.READONLY }, // compression program
                { address: MPL_BUBBLEGUM_PROGRAM_ID, role: AccountRole.READONLY }, // bubblegum program
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY }, // system program
                ...proof.map(node => ({ address: nodeToAddress(node), role: AccountRole.READONLY })),
            ],
            data: new Uint8Array(
                Buffer.concat([
                    Buffer.from(currentRoot()),
                    Buffer.from(dataHash),
                    Buffer.from(creatorHash),
                    u64(0n), // nonce
                    u32(0), // index
                ]),
            ),
        };

        await send([burn]);

        // Burning replaces the leaf with an empty node, so the tree is empty again.
        assert.deepEqual(currentRoot(), EMPTY_NODES[MAX_DEPTH], 'the tree should be empty after the burn');
    });
});
