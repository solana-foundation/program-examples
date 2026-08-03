import type { Program } from '@anchor-lang/core';
import * as anchor from '@anchor-lang/core';
import { PROGRAM_ID as BUBBLEGUM_PROGRAM_ID } from '@metaplex-foundation/mpl-bubblegum';
import { SPL_ACCOUNT_COMPRESSION_PROGRAM_ID, SPL_NOOP_PROGRAM_ID } from '@solana/spl-account-compression';
import type { CnftBurn } from '../target/types/cnft_burn';
import { createAndMint } from './createAndMint';
import { getcNFTsFromCollection } from './fetchNFTsByCollection';
import { getAsset, getAssetProof } from './readApi';
import { decode, mapProof } from './utils';

// Replace this with your custom RPC endpoint that supports cNFT indexing
const _RPC_PATH = 'https://api.devnet.solana.com';

describe('cnft-burn', () => {
    // Configure the client to use the local cluster.
    anchor.setProvider(anchor.AnchorProvider.env());

    const program = anchor.workspace.CnftBurn as Program<CnftBurn>;
    const provider = anchor.AnchorProvider.env();
    const payerWallet = provider.wallet as anchor.Wallet;

    let treeAddress: anchor.web3.PublicKey | undefined;
    const MPL_BUBBLEGUM_PROGRAM_ID_KEY = new anchor.web3.PublicKey(BUBBLEGUM_PROGRAM_ID);

    // this is the assetId of the cNft you want to burn
    let assetId = '';

    it('Should create the tree and mint a cnft', async () => {
        const { tree, collection } = await createAndMint();
        if (!tree.treeAddress) {
            throw new Error('Tree address not found');
        }
        treeAddress = tree.treeAddress;

        const fetchcNFTs = await getcNFTsFromCollection(collection.mint, payerWallet.publicKey.toString());
        console.log('fetchcNFTs', fetchcNFTs);
        assetId = fetchcNFTs[0];
    });
    it('Burn cNft!', async () => {
        const asset = await getAsset(assetId);

        const proof = await getAssetProof(assetId);
        const proofPathAsAccounts = mapProof(proof);
        const root = decode(proof.root);
        const dataHash = decode(asset.compression.data_hash);
        const creatorHash = decode(asset.compression.creator_hash);
        const nonce = new anchor.BN(asset.compression.leaf_id);
        const index = asset.compression.leaf_id;
        const [treeAuthority, _bump2] = anchor.web3.PublicKey.findProgramAddressSync(
            [treeAddress.toBuffer()],
            MPL_BUBBLEGUM_PROGRAM_ID_KEY,
        );
        const tx = await program.methods
            .burnCnft(root, dataHash, creatorHash, nonce, index)
            .accounts({
                merkleTree: treeAddress,
                leafOwner: payerWallet.publicKey,
                treeAuthority: treeAuthority,
                bubblegumProgram: BUBBLEGUM_PROGRAM_ID,
                compressionProgram: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
                logWrapper: SPL_NOOP_PROGRAM_ID,
                systemProgram: anchor.web3.SystemProgram.programId,
            })
            .remainingAccounts(proofPathAsAccounts)
            .rpc({
                skipPreflight: true,
            });
        console.log('Your transaction signature', tx);
        // here is a sample transaction signature on devnet
        // https://explorer.solana.com/tx/2MpeHi64pbWNY7BKBuhAp4yND5HdfQqNqkd8pu6F6meoSNUYRvxQgV5TC4w8BM8hUihB8G8TwBAaPRqS7pnN8Nu1?cluster=devnet
    });
});
