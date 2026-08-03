/**
 * Demonstrate the use of a few of the Metaplex Read API methods,
 * (needed to fetch compressed NFTs)
 */

// imports from other libraries
import type { PublicKey } from '@solana/web3.js';
import { RPC_PATH } from './cnft-burn';

// local import of the connection wrapper, to help with using the ReadApi
import { WrapperConnection } from './ReadApi/WrapperConnection';
// import custom helpers for demos
import { printConsoleSeparator } from './utils/helpers';

export async function getcNFTsFromCollection(collectionMint: PublicKey, owner: string) {
    // load the stored PublicKeys for ease of use
    // let keys = loadPublicKeysFromFile();

    // ensure the primary script was already run
    // if (!keys?.collectionMint)
    //   return console.warn("No local keys were found, specifically `collectionMint`");

    // convert the locally saved keys to PublicKeys
    // const collectionMint: PublicKey = keys.collectionMint;

    console.log('Collection mint:', collectionMint.toBase58());

    //////////////////////////////////////////////////////////////////////////////
    //////////////////////////////////////////////////////////////////////////////

    // load the env variables and store the cluster RPC url
    const CLUSTER_URL = RPC_PATH;

    // create a new rpc connection, using the ReadApi wrapper
    const connection = new WrapperConnection(CLUSTER_URL);

    printConsoleSeparator("Getting all assets by the 'collection' group...");

    const assets = await connection
        .getAssetsByGroup({
            groupKey: 'collection',
            groupValue: collectionMint.toBase58(),
            sortBy: {
                sortBy: 'recent_action',
                sortDirection: 'asc',
            },
        })
        .then(res => {
            console.log('Total assets returned:', res.total);

            // loop over each of the asset items in the collection
            const assetsIds = res.items?.map(asset => {
                // display a spacer between each of the assets
                console.log('\n===============================================');

                // print the entire asset record to the console
                // console.log(asset);

                // print some useful info
                console.log('assetId:', asset.id);
                console.log('ownership:', asset.ownership);
                console.log('compression:', asset.compression);

                if (asset.ownership?.owner === owner) {
                    console.log('assetId:', asset.id);
                    return asset.id;
                }
                return undefined;
            });

            return assetsIds;
        });

    return assets;
}
