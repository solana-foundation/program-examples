import {
    createDefaultRpcTransport,
    createJsonRpcApi,
    createRpc,
    type Address,
    type Rpc,
    type RpcResponse,
    type RpcResponseData,
} from '@solana/kit';

// The Metaplex Digital Asset Standard read API is a separate service from the
// base Solana JSON-RPC, so it needs its own endpoint including whatever auth
// the provider expects - Helius and Shyft take an API key as a query param,
// QuickNode and Triton as a path segment. There is no default: an endpoint
// carries a credential, so it belongs in .env.local rather than in source.
const DAS_URL = process.env.NEXT_PUBLIC_DAS_RPC;

interface DasSortBy {
    sortBy: 'created' | 'none' | 'recent_action' | 'updated';
    sortDirection: 'asc' | 'desc';
}

// An authority is an object in the DAS spec, but some providers return a bare
// address string.
export type DasAuthority = { address: string } | string;

export interface DasAsset {
    id: string;
    authorities: DasAuthority[];
    content: {
        metadata: { name: string };
        links: { image: string };
    };
}

export interface DasAssetList {
    total: number;
    limit: number;
    page: number;
    items: DasAsset[];
}

type DasApi = {
    getAssetsByOwner(params: {
        ownerAddress: Address;
        sortBy?: DasSortBy;
        limit?: number;
        page?: number;
        before?: string;
        after?: string;
    }): DasAssetList;
};

// DAS methods take a single named-parameter object rather than the positional
// arguments the base JSON-RPC uses, so the transformer lifts the lone call
// argument up to be the `params` payload.
const api = createJsonRpcApi<DasApi>({
    requestTransformer: request => ({ ...request, params: (request.params as unknown[])[0] }),
    responseTransformer: (response: RpcResponse) => {
        const rpcResponse = response as RpcResponseData<unknown>;
        if ('error' in rpcResponse) {
            throw new Error(`DAS RPC error ${rpcResponse.error.code}: ${rpcResponse.error.message}`);
        }
        return rpcResponse.result;
    },
});

// Null when NEXT_PUBLIC_DAS_RPC is unset. Callers surface that to the user
// instead of firing requests at an endpoint that cannot answer them.
export const dasRpc: Rpc<DasApi> | null = DAS_URL
    ? createRpc({ api, transport: createDefaultRpcTransport({ url: DAS_URL }) })
    : null;
