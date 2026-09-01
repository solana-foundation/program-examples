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
const PROGRAM_SO = path.join(FIXTURES, 'cnft_vault_pinocchio_program.so');
const BUBBLEGUM_SO = path.join(FIXTURES, 'mpl_bubblegum.so');
const ACCOUNT_COMPRESSION_SO = path.join(FIXTURES, 'spl_account_compression.so');
const NOOP_SO = path.join(FIXTURES, 'spl_noop.so');

// Instruction discriminators of this program.
const WITHDRAW_CNFT = 0;
const WITHDRAW_TWO_CNFTS = 1;

// The smallest valid (max_depth, max_buffer_size) pair the SPL Account
// Compression program accepts. Every tree here holds a single cNFT at index 0,
// which keeps each merkle proof to the three empty-node siblings on its path.
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

// The metadata minted onto every leaf. Leaving `creators` empty is deliberate:
// it makes the creator hash a constant (the keccak of no input) and keeps the
// metadata serialization below short.
const METADATA = {
    name: 'Vaulted cNFT',
    symbol: 'cNFT',
    uri: 'https://example.com/cnft.json',
    sellerFeeBasisPoints: 0,
};

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

/** Every tree here holds one leaf at index 0, so its siblings are all empty nodes. */
const PROOF = EMPTY_NODES.slice(0, MAX_DEPTH);

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
const DATA_HASH = keccak_256(Buffer.concat([keccak_256(serializeMetadataArgs()), u16(METADATA.sellerFeeBasisPoints)]));

/** With no creators the creator hash is just the keccak of an empty input. */
const CREATOR_HASH = keccak_256(new Uint8Array(0));

/** The `LeafSchema::V1` hash that the tree actually stores. */
function hashLeaf(assetId: Address, owner: Address, delegate: Address, nonce: bigint): Uint8Array {
    return keccak_256(
        Buffer.concat([
            Buffer.from([1]), // LeafSchema version V1
            encodeAddress(assetId),
            encodeAddress(owner),
            encodeAddress(delegate),
            u64(nonce),
            Buffer.from(DATA_HASH),
            Buffer.from(CREATOR_HASH),
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

/** The 108-byte transfer/burn argument blob bubblegum expects. */
function transferArgs(root: Uint8Array, nonce: bigint, index: number): Buffer {
    return Buffer.concat([
        Buffer.from(root),
        Buffer.from(DATA_HASH),
        Buffer.from(CREATOR_HASH),
        u64(nonce),
        u32(index),
    ]);
}

/** One tree, holding exactly one cNFT owned by the vault. */
interface Tree {
    merkleTree: Signer;
    treeAuthority: Address;
    assetId: Address;
}

describe('Compressed NFT Vault (Pinocchio)', () => {
    let svm: LiteSVM;
    let programId: Address;
    let payer: Signer;
    let vault: Address;
    let trees: Tree[];
    let recipients: Address[];

    before(async () => {
        svm = new LiteSVM();
        // The program derives its vault PDA from its own id, so a generated id
        // keeps the test self-contained.
        programId = (await generateKeyPairSigner()).address;
        svm.addProgramFromFile(programId, PROGRAM_SO);
        svm.addProgramFromFile(MPL_BUBBLEGUM_PROGRAM_ID, BUBBLEGUM_SO);
        svm.addProgramFromFile(SPL_ACCOUNT_COMPRESSION_PROGRAM_ID, ACCOUNT_COMPRESSION_SO);
        svm.addProgramFromFile(SPL_NOOP_PROGRAM_ID, NOOP_SO);

        payer = await generateKeyPairSigner();
        svm.airdrop(payer.address, lamports(100_000_000_000n));

        // The vault is never created as an account — it only ever signs.
        [vault] = await getProgramDerivedAddress({ programAddress: programId, seeds: ['cNFT-vault'] });

        // Three trees, one cNFT each: the first is withdrawn on its own, the
        // other two together. Giving each cNFT its own tree keeps every proof to
        // the empty-node path.
        trees = [];
        recipients = [];
        for (let i = 0; i < 3; i++) {
            trees.push(await createTree());
            recipients.push((await generateKeyPairSigner()).address);
        }
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

    /** Sends instructions expected to fail, returning the error for inspection. */
    async function sendExpectingFailure<
        TInstruction extends Parameters<typeof appendTransactionMessageInstructions>[0][number],
    >(instructions: TInstruction[]): Promise<string> {
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
        return String(result.err());
    }

    /** Reads a tree's current root out of its active change log. */
    function currentRoot(merkleTree: Address): Uint8Array {
        const account = svm.getAccount(merkleTree);
        if (!account.exists) {
            throw new Error('merkle tree account should exist');
        }
        const data = Buffer.from(account.data);
        const activeIndex = Number(data.readBigUInt64LE(ACTIVE_INDEX_OFFSET));
        const offset = CHANGE_LOGS_OFFSET + activeIndex * CHANGE_LOG_SIZE;
        return new Uint8Array(data.subarray(offset, offset + 32));
    }

    /** Allocates and initializes a tree, then mints one vault-owned cNFT into it. */
    async function createTree(): Promise<Tree> {
        const merkleTree = await generateKeyPairSigner();
        const [treeAuthority] = await getProgramDerivedAddress({
            programAddress: MPL_BUBBLEGUM_PROGRAM_ID,
            seeds: [addressEncoder.encode(merkleTree.address)],
        });
        const [assetId] = await getProgramDerivedAddress({
            programAddress: MPL_BUBBLEGUM_PROGRAM_ID,
            seeds: ['asset', addressEncoder.encode(merkleTree.address), u64(0n)],
        });

        // The tree account is allocated by the system program and handed to the
        // compression program, which initializes it during `create_tree`.
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
                    Buffer.from([0]), // public: None
                ]),
            ),
        };

        // The vault PDA is named as the leaf owner, which is all it means for the
        // vault to "hold" a compressed NFT.
        const mintIx = {
            programAddress: MPL_BUBBLEGUM_PROGRAM_ID,
            accounts: [
                { address: treeAuthority, role: AccountRole.WRITABLE },
                { address: vault, role: AccountRole.READONLY }, // leaf owner
                { address: vault, role: AccountRole.READONLY }, // leaf delegate
                { address: merkleTree.address, role: AccountRole.WRITABLE },
                { address: payer.address, role: AccountRole.READONLY_SIGNER, signer: payer }, // payer
                { address: payer.address, role: AccountRole.READONLY_SIGNER, signer: payer }, // tree delegate
                { address: SPL_NOOP_PROGRAM_ID, role: AccountRole.READONLY },
                { address: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID, role: AccountRole.READONLY },
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ],
            data: new Uint8Array(Buffer.concat([anchorDiscriminator('mint_v1'), serializeMetadataArgs()])),
        };

        await send([createAccount, createTreeIx, mintIx]);
        return { merkleTree, treeAuthority, assetId };
    }

    it('Holds a compressed NFT in the vault', () => {
        // Recomputing each root locally proves the leaf hash — and with it the
        // data and creator hashes the withdrawals depend on — matches what
        // bubblegum stored, and that the vault is the recorded owner.
        for (const tree of trees) {
            const leaf = hashLeaf(tree.assetId, vault, vault, 0n);
            assert.deepEqual(
                currentRoot(tree.merkleTree.address),
                rootWithSingleLeaf(leaf),
                'the vault should own the minted cNFT',
            );
        }
    });

    it('Withdraws a compressed NFT', async () => {
        const tree = trees[0];
        const recipient = recipients[0];

        const withdraw = {
            programAddress: programId,
            accounts: [
                { address: tree.treeAuthority, role: AccountRole.READONLY }, // tree authority
                { address: vault, role: AccountRole.READONLY }, // vault PDA
                { address: recipient, role: AccountRole.READONLY }, // new leaf owner
                { address: tree.merkleTree.address, role: AccountRole.WRITABLE }, // merkle tree
                { address: SPL_NOOP_PROGRAM_ID, role: AccountRole.READONLY }, // log wrapper
                { address: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID, role: AccountRole.READONLY }, // compression program
                { address: MPL_BUBBLEGUM_PROGRAM_ID, role: AccountRole.READONLY }, // bubblegum program
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY }, // system program
                ...PROOF.map(node => ({ address: nodeToAddress(node), role: AccountRole.READONLY })),
            ],
            data: new Uint8Array(
                Buffer.concat([
                    Buffer.from([WITHDRAW_CNFT]),
                    transferArgs(currentRoot(tree.merkleTree.address), 0n, 0),
                ]),
            ),
        };

        await send([withdraw]);

        // A transfer rewrites the leaf with the new owner as both owner and
        // delegate, so the tree's root moves to exactly that leaf.
        const expected = rootWithSingleLeaf(hashLeaf(tree.assetId, recipient, recipient, 0n));
        assert.deepEqual(currentRoot(tree.merkleTree.address), expected, 'the recipient should own the cNFT');
    });

    it('Withdraws two compressed NFTs from two trees in one instruction', async () => {
        const [first, second] = [trees[1], trees[2]];
        const [firstRecipient, secondRecipient] = [recipients[1], recipients[2]];

        const withdrawTwo = {
            programAddress: programId,
            accounts: [
                { address: first.treeAuthority, role: AccountRole.READONLY }, // first tree authority
                { address: vault, role: AccountRole.READONLY }, // vault PDA
                { address: firstRecipient, role: AccountRole.READONLY }, // first new leaf owner
                { address: first.merkleTree.address, role: AccountRole.WRITABLE }, // first merkle tree
                { address: second.treeAuthority, role: AccountRole.READONLY }, // second tree authority
                { address: secondRecipient, role: AccountRole.READONLY }, // second new leaf owner
                { address: second.merkleTree.address, role: AccountRole.WRITABLE }, // second merkle tree
                { address: SPL_NOOP_PROGRAM_ID, role: AccountRole.READONLY }, // log wrapper
                { address: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID, role: AccountRole.READONLY }, // compression program
                { address: MPL_BUBBLEGUM_PROGRAM_ID, role: AccountRole.READONLY }, // bubblegum program
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY }, // system program
                // Both proofs, concatenated; the instruction data says where to split.
                ...PROOF.map(node => ({ address: nodeToAddress(node), role: AccountRole.READONLY })),
                ...PROOF.map(node => ({ address: nodeToAddress(node), role: AccountRole.READONLY })),
            ],
            data: new Uint8Array(
                Buffer.concat([
                    Buffer.from([WITHDRAW_TWO_CNFTS]),
                    transferArgs(currentRoot(first.merkleTree.address), 0n, 0),
                    Buffer.from([PROOF.length]),
                    transferArgs(currentRoot(second.merkleTree.address), 0n, 0),
                    Buffer.from([PROOF.length]),
                ]),
            ),
        };

        await send([withdrawTwo]);

        assert.deepEqual(
            currentRoot(first.merkleTree.address),
            rootWithSingleLeaf(hashLeaf(first.assetId, firstRecipient, firstRecipient, 0n)),
            'the first recipient should own their cNFT',
        );
        assert.deepEqual(
            currentRoot(second.merkleTree.address),
            rootWithSingleLeaf(hashLeaf(second.assetId, secondRecipient, secondRecipient, 0n)),
            'the second recipient should own their cNFT',
        );
    });

    it('Rejects proof lengths that do not add up to the accounts supplied', async () => {
        // The two proof lengths are what splits the account tail, so a caller
        // that overstates one could make the second transfer read accounts the
        // first already used. The program checks the split against the accounts
        // actually passed and refuses before doing anything else.
        const [first, second] = [trees[1], trees[2]];

        const badSplit = {
            programAddress: programId,
            accounts: [
                { address: first.treeAuthority, role: AccountRole.READONLY },
                { address: vault, role: AccountRole.READONLY },
                { address: recipients[1], role: AccountRole.READONLY },
                { address: first.merkleTree.address, role: AccountRole.WRITABLE },
                { address: second.treeAuthority, role: AccountRole.READONLY },
                { address: recipients[2], role: AccountRole.READONLY },
                { address: second.merkleTree.address, role: AccountRole.WRITABLE },
                { address: SPL_NOOP_PROGRAM_ID, role: AccountRole.READONLY },
                { address: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID, role: AccountRole.READONLY },
                { address: MPL_BUBBLEGUM_PROGRAM_ID, role: AccountRole.READONLY },
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
                ...PROOF.map(node => ({ address: nodeToAddress(node), role: AccountRole.READONLY })),
                ...PROOF.map(node => ({ address: nodeToAddress(node), role: AccountRole.READONLY })),
            ],
            data: new Uint8Array(
                Buffer.concat([
                    Buffer.from([WITHDRAW_TWO_CNFTS]),
                    transferArgs(currentRoot(first.merkleTree.address), 0n, 0),
                    Buffer.from([PROOF.length + 1]), // one node more than was supplied
                    transferArgs(currentRoot(second.merkleTree.address), 0n, 0),
                    Buffer.from([PROOF.length]),
                ]),
            ),
        };

        const error = await sendExpectingFailure([badSplit]);
        assert.include(error, 'InvalidInstructionData', 'the mismatched split should be rejected');
    });
});
