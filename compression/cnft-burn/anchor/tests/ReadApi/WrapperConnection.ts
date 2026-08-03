// local imports for the ReadApi types

import type { Metadata, Mint, NftOriginalEdition, SplTokenCurrency } from '@metaplex-foundation/js';
// import from the `@metaplex-foundation/js`
import { amount, MetaplexError, Pda, toBigNumber } from '@metaplex-foundation/js';
import { PROGRAM_ID as BUBBLEGUM_PROGRAM_ID } from '@metaplex-foundation/mpl-bubblegum';
import { TokenStandard } from '@metaplex-foundation/mpl-token-metadata';
import { Connection, PublicKey } from '@solana/web3.js';
import BN from 'bn.js';
import type {
    GetAssetProofRpcInput,
    GetAssetProofRpcResponse,
    GetAssetRpcInput,
    GetAssetsByGroupRpcInput,
    GetAssetsByOwnerRpcInput,
    ReadApiAsset,
    ReadApiAssetList,
} from '@/ReadApi/types';

type JsonRpcParams<ReadApiMethodParams> = {
    method: string;
    id?: string;
    params: ReadApiMethodParams;
};

type JsonRpcOutput<ReadApiJsonOutput> = {
    result: ReadApiJsonOutput;
};

/** @group Errors */
export class ReadApiError extends MetaplexError {
    readonly name: string = 'ReadApiError';
    constructor(message: string, cause?: Error) {
        super(message, 'rpc', undefined, cause);
    }
}

/**
 * Convert a ReadApi asset (e.g. compressed NFT) into an NftEdition
 */
export const toNftEditionFromReadApiAsset = (input: ReadApiAsset): NftOriginalEdition => {
    return {
        model: 'nftEdition',
        isOriginal: true,
        address: new PublicKey(input.id),
        supply: toBigNumber(input.supply.print_current_supply),
        maxSupply: toBigNumber(input.supply.print_max_supply),
    };
};

/**
 * Convert a ReadApi asset (e.g. compressed NFT) into an NFT mint
 */
export const toMintFromReadApiAsset = (input: ReadApiAsset): Mint => {
    const currency: SplTokenCurrency = {
        symbol: 'Token',
        decimals: 0,
        namespace: 'spl-token',
    };

    return {
        model: 'mint',
        address: new PublicKey(input.id),
        mintAuthorityAddress: new PublicKey(input.id),
        freezeAuthorityAddress: new PublicKey(input.id),
        decimals: 0,
        supply: amount(1, currency),
        isWrappedSol: false,
        currency,
    };
};

/**
 * Convert a ReadApi asset's data into standard Metaplex `Metadata`
 */
export const toMetadataFromReadApiAsset = (input: ReadApiAsset): Metadata => {
    const updateAuthority = input.authorities?.find(authority => authority.scopes.includes('full'));

    const collection = input.grouping.find(({ group_key }) => group_key === 'collection');

    return {
        model: 'metadata',
        /**
         * We technically don't have a metadata address anymore.
         * So we are using the asset's id as the address
         */
        address: Pda.find(BUBBLEGUM_PROGRAM_ID, [
            Buffer.from('asset', 'utf-8'),
            new PublicKey(input.compression.tree).toBuffer(),
            Uint8Array.from(new BN(input.compression.leaf_id).toArray('le', 8)),
        ]),
        mintAddress: new PublicKey(input.id),
        updateAuthorityAddress: new PublicKey(updateAuthority?.address),

        name: input.content.metadata?.name ?? '',
        symbol: input.content.metadata?.symbol ?? '',

        json: input.content.metadata,
        jsonLoaded: true,
        uri: input.content.json_uri,
        isMutable: input.mutable,

        primarySaleHappened: input.royalty.primary_sale_happened,
        sellerFeeBasisPoints: input.royalty.basis_points,
        creators: input.creators,

        editionNonce: input.supply.edition_nonce,
        tokenStandard: TokenStandard.NonFungible,

        collection: collection ? { address: new PublicKey(collection.group_value), verified: false } : null,

        // Current regular `Metadata` does not currently have a `compression` value
        // @ts-expect-error
        compression: input.compression,

        // Read API doesn't return this info, yet
        collectionDetails: null,
        // Read API doesn't return this info, yet
        uses: null,
        // Read API doesn't return this info, yet
        programmableConfig: null,
    };
};

/**
 * Wrapper class to add additional methods on top the standard Connection from `@solana/web3.js`
 * Specifically, adding the RPC methods used by the Digital Asset Standards (DAS) ReadApi
 * for state compression and compressed NFTs
 */
export class WrapperConnection extends Connection {
    private callReadApi = async <ReadApiMethodParams, ReadApiJsonOutput>(
        jsonRpcParams: JsonRpcParams<ReadApiMethodParams>,
    ): Promise<JsonRpcOutput<ReadApiJsonOutput>> => {
        const response = await fetch(this.rpcEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                jsonrpc: '2.0',
                method: jsonRpcParams.method,
                id: jsonRpcParams.id ?? 'rpd-op-123',
                params: jsonRpcParams.params,
            }),
        });

        return (await response.json()) as JsonRpcOutput<ReadApiJsonOutput>;
    };

    // Asset id can be calculated via Bubblegum#getLeafAssetId
    // It is a PDA with the following seeds: ["asset", tree, leafIndex]
    async getAsset(assetId: PublicKey): Promise<ReadApiAsset> {
        const { result: asset } = await this.callReadApi<GetAssetRpcInput, ReadApiAsset>({
            method: 'getAsset',
            params: {
                id: assetId.toBase58(),
            },
        });

        if (!asset) throw new ReadApiError('No asset returned');

        return asset;
    }

    // Asset id can be calculated via Bubblegum#getLeafAssetId
    // It is a PDA with the following seeds: ["asset", tree, leafIndex]
    async getAssetProof(assetId: PublicKey): Promise<GetAssetProofRpcResponse> {
        const { result: proof } = await this.callReadApi<GetAssetProofRpcInput, GetAssetProofRpcResponse>({
            method: 'getAssetProof',
            params: {
                id: assetId.toBase58(),
            },
        });

        if (!proof) throw new ReadApiError('No asset proof returned');

        return proof;
    }

    //
    async getAssetsByGroup({
        groupKey,
        groupValue,
        page,
        limit,
        sortBy,
        before,
        after,
    }: GetAssetsByGroupRpcInput): Promise<ReadApiAssetList> {
        // `page` cannot be supplied with `before` or `after`
        if (typeof page === 'number' && (before || after))
            throw new ReadApiError('Pagination Error. Only one pagination parameter supported per query.');

        // a pagination method MUST be selected, but we are defaulting to using `page=0`

        const { result } = await this.callReadApi<GetAssetsByGroupRpcInput, ReadApiAssetList>({
            method: 'getAssetsByGroup',
            params: {
                groupKey,
                groupValue,
                after: after ?? null,
                before: before ?? null,
                limit: limit ?? null,
                page: page ?? 1,
                sortBy: sortBy ?? null,
            },
        });

        if (!result) throw new ReadApiError('No results returned');

        return result;
    }

    //
    async getAssetsByOwner({
        ownerAddress,
        page,
        limit,
        sortBy,
        before,
        after,
    }: GetAssetsByOwnerRpcInput): Promise<ReadApiAssetList> {
        // `page` cannot be supplied with `before` or `after`
        if (typeof page === 'number' && (before || after))
            throw new ReadApiError('Pagination Error. Only one pagination parameter supported per query.');

        // a pagination method MUST be selected, but we are defaulting to using `page=0`

        const { result } = await this.callReadApi<GetAssetsByOwnerRpcInput, ReadApiAssetList>({
            method: 'getAssetsByOwner',
            params: {
                ownerAddress,
                after: after ?? null,
                before: before ?? null,
                limit: limit ?? null,
                page: page ?? 1,
                sortBy: sortBy ?? null,
            },
        });

        if (!result) throw new ReadApiError('No results returned');

        return result;
    }
}
