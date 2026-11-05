// Hand-rolled instructions for the Metaplex Token Metadata program.
//
// Built directly from the wire format (discriminator + borsh-encoded args +
// documented account order) so the tests need no `mpl-token-metadata`
// dependency, matching how the native examples in this repo do it. The program
// itself is loaded into litesvm from tests/fixtures/token_metadata.so.

import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';

export const TOKEN_METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

// Variants of the Token Metadata program's instruction enum.
const CREATE_METADATA_ACCOUNT_V3 = 33;
const CREATE_MASTER_EDITION_V3 = 17;
const VERIFY_COLLECTION = 18;

// --- minimal borsh writers -------------------------------------------------

const u8 = (n: number) => Buffer.from([n]);

const u16 = (n: number) => {
    const b = Buffer.alloc(2);
    b.writeUInt16LE(n);
    return b;
};

const u64 = (n: bigint) => {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(n);
    return b;
};

const borshString = (s: string) => {
    const bytes = Buffer.from(s, 'utf8');
    const len = Buffer.alloc(4);
    len.writeUInt32LE(bytes.length);
    return Buffer.concat([len, bytes]);
};

/** `None` for any inner type is a single zero byte. */
const NONE = u8(0);

// --- PDAs ------------------------------------------------------------------

export const metadataPda = (mint: PublicKey) =>
    PublicKey.findProgramAddressSync(
        [Buffer.from('metadata'), TOKEN_METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
        TOKEN_METADATA_PROGRAM_ID,
    )[0];

export const masterEditionPda = (mint: PublicKey) =>
    PublicKey.findProgramAddressSync(
        [Buffer.from('metadata'), TOKEN_METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer(), Buffer.from('edition')],
        TOKEN_METADATA_PROGRAM_ID,
    )[0];

// --- instructions ----------------------------------------------------------

/**
 * `CreateMetadataAccountV3`: creates the metadata account for `mint`.
 *
 * When `collection` is given it is written with `verified: false` — Metaplex
 * will not accept a self-asserted `true`. Verification is a separate,
 * authority-signed step; see `verifyCollection`.
 */
export const createMetadataAccountV3 = ({
    mint,
    mintAuthority,
    payer,
    updateAuthority,
    name,
    symbol,
    uri,
    collection,
}: {
    mint: PublicKey;
    mintAuthority: PublicKey;
    payer: PublicKey;
    updateAuthority: PublicKey;
    name: string;
    symbol: string;
    uri: string;
    collection?: PublicKey;
}): TransactionInstruction => {
    const dataV2 = Buffer.concat([
        borshString(name),
        borshString(symbol),
        borshString(uri),
        u16(0), // seller_fee_basis_points
        NONE, // creators
        collection ? Buffer.concat([u8(1), u8(0), collection.toBuffer()]) : NONE,
        NONE, // uses
    ]);

    const data = Buffer.concat([
        u8(CREATE_METADATA_ACCOUNT_V3),
        dataV2,
        u8(1), // is_mutable
        NONE, // collection_details
    ]);

    return new TransactionInstruction({
        programId: TOKEN_METADATA_PROGRAM_ID,
        keys: [
            { pubkey: metadataPda(mint), isSigner: false, isWritable: true },
            { pubkey: mint, isSigner: false, isWritable: false },
            { pubkey: mintAuthority, isSigner: true, isWritable: false },
            { pubkey: payer, isSigner: true, isWritable: true },
            { pubkey: updateAuthority, isSigner: true, isWritable: false },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data,
    });
};

/**
 * `CreateMasterEditionV3`: marks the mint as an NFT and moves its mint and
 * freeze authorities to the master edition PDA.
 *
 * This is what makes staking possible at all: the freeze authority has to be
 * the master edition for Token Metadata to freeze the token account on a
 * delegate's behalf.
 */
export const createMasterEditionV3 = ({
    mint,
    updateAuthority,
    mintAuthority,
    payer,
}: {
    mint: PublicKey;
    updateAuthority: PublicKey;
    mintAuthority: PublicKey;
    payer: PublicKey;
}): TransactionInstruction =>
    new TransactionInstruction({
        programId: TOKEN_METADATA_PROGRAM_ID,
        keys: [
            { pubkey: masterEditionPda(mint), isSigner: false, isWritable: true },
            { pubkey: mint, isSigner: false, isWritable: true },
            { pubkey: updateAuthority, isSigner: true, isWritable: false },
            { pubkey: mintAuthority, isSigner: true, isWritable: false },
            { pubkey: payer, isSigner: true, isWritable: true },
            { pubkey: metadataPda(mint), isSigner: false, isWritable: true },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        // max_supply: Some(0) — a one-of-one, no prints.
        data: Buffer.concat([u8(CREATE_MASTER_EDITION_V3), u8(1), u64(0n)]),
    });

/**
 * `VerifyCollection`: the collection's update authority signs to confirm that
 * `mint` really belongs to `collectionMint`, flipping `collection.verified`
 * to true. Until this runs, the collection field on an NFT is just a claim —
 * which is exactly why the staking program checks the flag.
 */
export const verifyCollection = ({
    mint,
    collectionMint,
    collectionAuthority,
    payer,
}: {
    mint: PublicKey;
    collectionMint: PublicKey;
    collectionAuthority: PublicKey;
    payer: PublicKey;
}): TransactionInstruction =>
    new TransactionInstruction({
        programId: TOKEN_METADATA_PROGRAM_ID,
        keys: [
            { pubkey: metadataPda(mint), isSigner: false, isWritable: true },
            { pubkey: collectionAuthority, isSigner: true, isWritable: false },
            { pubkey: payer, isSigner: true, isWritable: true },
            { pubkey: collectionMint, isSigner: false, isWritable: false },
            { pubkey: metadataPda(collectionMint), isSigner: false, isWritable: true },
            { pubkey: masterEditionPda(collectionMint), isSigner: false, isWritable: false },
        ],
        data: u8(VERIFY_COLLECTION),
    });
