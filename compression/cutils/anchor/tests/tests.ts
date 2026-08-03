import * as anchor from '@anchor-lang/core';
import { PROGRAM_ID as BUBBLEGUM_PROGRAM_ID } from '@metaplex-foundation/mpl-bubblegum/dist/src/generated';
import type { Cutils } from '../target/types/cutils';
import { loadOrGenerateKeypair, loadPublicKeysFromFile } from './utils/helpers';
import { getAccounts } from './utils/utils';

describe('cutils', () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const program = anchor.workspace.Cutils as anchor.Program<Cutils>;

    // NFT metadata pointer
    // TODO change
    const uri = 'https://arweave.net/nVRvZDaOk5YAdr4ZBEeMjOVhynuv8P3vywvuN5sYSPo';

    const payer = loadOrGenerateKeypair('payer');

    // cNFT receiver
    const testWallet = loadOrGenerateKeypair('testWallet');

    const { collectionMint, treeAddress } = loadPublicKeysFromFile();

    it('Mint!', async () => {
        const tx = await program.methods
            .mint({ uri })
            .accounts({
                payer: payer.publicKey,
                leafOwner: testWallet.publicKey,
                leafDelegate: testWallet.publicKey, //verify
                treeDelegate: payer.publicKey,
                collectionAuthority: payer.publicKey,
                collectionAuthorityRecordPda: BUBBLEGUM_PROGRAM_ID,
                ...getAccounts(collectionMint, treeAddress),
            })
            .transaction();

        const sx = await program.provider.sendAndConfirm(tx, [payer], {
            skipPreflight: true,
        });
        console.log(`   Tx Signature: ${sx}`);
    });

    // it("Verify", async () => {
    //     // TODO: replace assetId
    //     const assetId = "HUBMRAcYpow1ZUojdSMuvhcbNuCuRSAPWnXWjjYrpAVQ";
    //
    //     const asset = await getAsset(assetId);
    //     const proof = await getAssetProof(assetId);
    //     const proofPathAsAccounts = mapProof(proof);
    //     const root = decode(proof.root);
    //     const dataHash = decode(asset.compression.data_hash);
    //     const creatorHash = decode(asset.compression.creator_hash);
    //     const nonce = new anchor.BN(asset.compression.leaf_id);
    //     const index = asset.compression.leaf_id;
    //
    //     const tx = await program.methods
    //         .verify({
    //             root, dataHash, creatorHash, nonce, index
    //         })
    //         .accounts({
    //             leafOwner: testWallet.publicKey,
    //             leafDelegate: testWallet.publicKey,
    //             merkleTree: treeAddress,
    //             compressionProgram: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
    //         })
    //         .remainingAccounts(proofPathAsAccounts)
    //         .transaction();
    //
    //     const sx = await program.provider.sendAndConfirm(tx, [testWallet], {skipPreflight: true});
    //
    //     // This fails due to incorrect owner
    //     // const sx = await program.provider.sendAndConfirm(tx, [payer], {skipPreflight: true});
    //
    //     console.log(`   Tx Signature: ${sx}`);
    // });
});
