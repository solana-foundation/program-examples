import type { CreateMetadataAccountArgsV3 } from '@metaplex-foundation/mpl-token-metadata';
import type { ValidDepthSizePair } from '@solana/spl-account-compression';
import { Connection, Keypair } from '@solana/web3.js';
import { createCollection, createTree } from './utils/compression';
import { loadOrGenerateKeypair, savePublicKeyToFile } from './utils/helpers';

async function _setup() {
    const rpc = 'https://api.devnet.solana.com';
    const connection = new Connection(rpc, 'confirmed');

    // Collection auth and treeCreator
    const payer = loadOrGenerateKeypair('payer');

    // Airdrop
    await connection.requestAirdrop(payer.publicKey, 1 * 10 ** 9);
    console.log('Payer address:', payer.publicKey.toBase58());

    const treeKeypair = Keypair.generate();
    const maxDepthSizePair: ValidDepthSizePair = {
        maxDepth: 14,
        maxBufferSize: 64,
    };
    const canopyDepth = maxDepthSizePair.maxDepth - 5;
    const tree = await createTree(connection, payer, treeKeypair, maxDepthSizePair, canopyDepth);

    // locally save the addresses for demo
    savePublicKeyToFile('treeAddress', tree.treeAddress);

    const collectionMetadataV3: CreateMetadataAccountArgsV3 = {
        data: {
            name: 'Super Sweet NFT Collection',
            symbol: 'SSNC',
            // specific json metadata for the collection
            uri: 'https://supersweetcollection.notarealurl/collection.json',
            sellerFeeBasisPoints: 100,
            creators: [
                {
                    address: payer.publicKey,
                    verified: false,
                    share: 100,
                },
            ],
            collection: null,
            uses: null,
        },
        isMutable: false,
        collectionDetails: null,
    };

    // create a full token mint and initialize the collection (with the `payer` as the authority)
    const collection = await createCollection(connection, payer, collectionMetadataV3);

    // locally save the addresses for the demo
    savePublicKeyToFile('collectionMint', collection.mint);
}

// setup()
