import { PROGRAM_ID as BUBBLEGUM_PROGRAM_ID } from '@metaplex-foundation/mpl-bubblegum/dist/src/generated';
import { PROGRAM_ID as TOKEN_METADATA_PROGRAM_ID } from '@metaplex-foundation/mpl-token-metadata/dist/src/generated';
import { SPL_ACCOUNT_COMPRESSION_PROGRAM_ID, SPL_NOOP_PROGRAM_ID } from '@solana/spl-account-compression';
import { type AccountMeta, PublicKey, SystemProgram } from '@solana/web3.js';
import * as bs58 from 'bs58';

export function decode(stuff: string) {
    return bufferToArray(bs58.decode(stuff));
}
function bufferToArray(buffer: Buffer): number[] {
    const nums: number[] = [];
    for (let i = 0; i < buffer.length; i++) {
        nums.push(buffer[i]);
    }
    return nums;
}
export const mapProof = (assetProof: { proof: string[] }): AccountMeta[] => {
    if (!assetProof.proof || assetProof.proof.length === 0) {
        throw new Error('Proof is empty');
    }
    return assetProof.proof.map(node => ({
        pubkey: new PublicKey(node),
        isSigner: false,
        isWritable: false,
    }));
};

export function getAccounts(collectionMint: PublicKey, tree: PublicKey) {
    // treeAuth
    const [treeAuthority] = PublicKey.findProgramAddressSync([tree.toBuffer()], BUBBLEGUM_PROGRAM_ID);

    // derive a PDA (owned by Bubblegum) to act as the signer of the compressed minting
    const [bubblegumSigner] = PublicKey.findProgramAddressSync(
        // `collection_cpi` is a custom prefix required by the Bubblegum program
        [Buffer.from('collection_cpi', 'utf8')],
        BUBBLEGUM_PROGRAM_ID,
    );

    // collection metadata account
    const [metadataAccount] = PublicKey.findProgramAddressSync(
        [Buffer.from('metadata', 'utf8'), TOKEN_METADATA_PROGRAM_ID.toBuffer(), collectionMint.toBuffer()],
        TOKEN_METADATA_PROGRAM_ID,
    );

    // collection master edition
    const [masterEditionAccount] = PublicKey.findProgramAddressSync(
        [
            Buffer.from('metadata', 'utf8'),
            TOKEN_METADATA_PROGRAM_ID.toBuffer(),
            collectionMint.toBuffer(),
            Buffer.from('edition', 'utf8'),
        ],
        TOKEN_METADATA_PROGRAM_ID,
    );

    return {
        treeAuthority,
        collectionMint,
        collectionMetadata: metadataAccount,
        editionAccount: masterEditionAccount,
        merkleTree: tree,

        bubblegumSigner,
        logWrapper: SPL_NOOP_PROGRAM_ID,
        compressionProgram: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
        tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
        bubblegumProgram: BUBBLEGUM_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
    };
}
