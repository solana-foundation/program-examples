import * as anchor from '@anchor-lang/core';
import { PROGRAM_ID as BUBBLEGUM_PROGRAM_ID } from '@metaplex-foundation/mpl-bubblegum';
import { SPL_ACCOUNT_COMPRESSION_PROGRAM_ID, SPL_NOOP_PROGRAM_ID } from '@solana/spl-account-compression';
import { getAsset, getAssetProof } from '../readAPI';
import { decode, mapProof } from '../utils';

import { program, programID } from './constants';

async function main() {
    const [vaultPDA, _bump] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from('cNFT-vault', 'utf8')],
        programID,
    );

    const tree = new anchor.web3.PublicKey('trezdkTFPKyj4gE9LAJYPpxn8AYVCvM7Mc4JkTb9X5B');

    const receiver = new anchor.web3.PublicKey('Andys9wuoMdUeRiZLgRS5aJwYNFv4Ut6qQi8PNDTAPEM');

    const [treeAuthority, _bump2] = anchor.web3.PublicKey.findProgramAddressSync(
        [tree.toBuffer()],
        BUBBLEGUM_PROGRAM_ID,
    );

    const assetId = 'DGWU3mHenDerCvjkeDsKYEbsvXbWvqdo1bVoXy3dkeTd';
    const asset = await getAsset(assetId);
    // console.log(res)

    const proof = await getAssetProof(assetId);
    const proofPathAsAccounts = mapProof(proof);

    const root = decode(proof.root);
    const dataHash = decode(asset.compression.data_hash);
    const creatorHash = decode(asset.compression.creator_hash);
    const nonce = new anchor.BN(asset.compression.leaf_id);
    const index = asset.compression.leaf_id;

    const tx = await program.methods
        .withdrawCnft(root, dataHash, creatorHash, nonce, index)
        .accounts({
            leafOwner: vaultPDA,
            merkleTree: tree,
            newLeafOwner: receiver,
            treeAuthority: treeAuthority,
            bubblegumProgram: BUBBLEGUM_PROGRAM_ID,
            compressionProgram: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
            logWrapper: SPL_NOOP_PROGRAM_ID,
            systemProgram: anchor.web3.SystemProgram.programId,
        })
        .remainingAccounts(proofPathAsAccounts)
        .rpc();
    console.log(tx);
}

main();
