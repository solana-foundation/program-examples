import { Connection } from '@solana/web3.js';
import axios from 'axios';
import { METAPLEX_READAPI } from './anchor';

interface SortBy {
    sortBy: string;
    sortDirection: string;
}

export class WrappedConnection extends Connection {
    async getAsset(assetId: string): Promise<unknown> {
        try {
            const response = await axios.post(
                process.env.NEXT_PUBLIC_RPC ? process.env.NEXT_PUBLIC_RPC : METAPLEX_READAPI,
                {
                    jsonrpc: '2.0',
                    method: 'getAsset',
                    id: 'compression-example',
                    params: [assetId],
                },
            );
            return response.data.result;
        } catch (error) {
            console.error(error);
        }
    }

    async getAssetProof(assetId: string): Promise<unknown> {
        try {
            const response = await axios.post(
                process.env.NEXT_PUBLIC_RPC ? process.env.NEXT_PUBLIC_RPC : METAPLEX_READAPI,
                {
                    jsonrpc: '2.0',
                    method: 'getAssetProof',
                    id: 'compression-example',
                    params: [assetId],
                },
            );
            return response.data.result;
        } catch (error) {
            console.error(error);
        }
    }

    async getAssetsByOwner(
        assetId: string,
        sortBy: SortBy,
        limit: number,
        page: number,
        before: string,
        after: string,
    ): Promise<unknown> {
        try {
            const response = await axios.post(
                process.env.NEXT_PUBLIC_RPC ? process.env.NEXT_PUBLIC_RPC : METAPLEX_READAPI,
                {
                    jsonrpc: '2.0',
                    method: 'getAssetsByOwner',
                    id: 'rpd-op-123',
                    params: [assetId, sortBy, limit, page, before, after],
                },
            );
            //console.log("getAssetsByOwner: " + JSON.stringify(response.data));
            return response.data.result;
        } catch (error) {
            console.error(error);
        }
    }

    async getAssetsByCreator(
        assetId: string,
        sortBy: SortBy,
        limit: number,
        page: number,
        _before: string,
        _after: string,
    ): Promise<unknown> {
        try {
            const response = await axios.post(
                process.env.NEXT_PUBLIC_RPC ? process.env.NEXT_PUBLIC_RPC : METAPLEX_READAPI,
                {
                    jsonrpc: '2.0',
                    method: 'getAssetsByCreator',
                    id: 'compression-example',
                    params: [assetId, true, sortBy, limit, page, null, null],
                },
            );

            return response.data.result;
        } catch (error) {
            console.error(error);
        }
    }

    async getAssetsByAuthority(
        assetId: string,
        sortBy: SortBy,
        limit: number,
        page: number,
        before: string,
        after: string,
    ): Promise<unknown> {
        try {
            const response = await axios.post(
                process.env.NEXT_PUBLIC_RPC ? process.env.NEXT_PUBLIC_RPC : METAPLEX_READAPI,
                {
                    jsonrpc: '2.0',
                    method: 'getAssetsByAuthority',
                    id: 'compression-example',
                    params: [assetId, sortBy, limit, page, before, after],
                },
            );
            return response.data.result;
        } catch (error) {
            console.error(error);
        }
    }

    async getAssetsByGroup(
        groupKey: string,
        groupValue: string,
        sortBy: SortBy,
        limit: number,
        page: number,
        before: string,
        after: string,
    ): Promise<unknown> {
        try {
            const events = [];

            const response = await axios.post(
                process.env.NEXT_PUBLIC_RPC ? process.env.NEXT_PUBLIC_RPC : METAPLEX_READAPI,
                {
                    jsonrpc: '2.0',
                    method: 'getAssetsByGroup',
                    id: 'rpd-op-123',
                    params: [groupKey, groupValue, sortBy, limit, page, before, after],
                },
            );
            events.push(...response.data.result.items);

            return events;
        } catch (error) {
            console.error(error);
        }
    }

    // Loop through all pages and return all assets
    async getAllAssetsByGroup(
        groupKey: string,
        groupValue: string,
        sortBy: SortBy,
        limit: number,
        startPage: number,
        before: string,
        after: string,
    ): Promise<unknown> {
        let page = startPage;
        try {
            const events = [];
            let response = await axios.post(
                process.env.NEXT_PUBLIC_RPC ? process.env.NEXT_PUBLIC_RPC : METAPLEX_READAPI,
                {
                    jsonrpc: '2.0',
                    method: 'getAssetsByGroup',
                    id: 'rpd-op-123',
                    params: [groupKey, groupValue, sortBy, limit, page, before, after],
                },
            );

            events.push(...response.data.result.items);

            while (true) {
                console.log(`Requested page${page}`);

                page += 1;
                response = await axios.post(
                    process.env.NEXT_PUBLIC_RPC ? process.env.NEXT_PUBLIC_RPC : METAPLEX_READAPI,
                    {
                        jsonrpc: '2.0',
                        method: 'getAssetsByGroup',
                        id: 'rpd-op-123',
                        params: [groupKey, groupValue, sortBy, limit, page, before, after],
                    },
                );

                events.push(...response.data.result.items);
                if (events.length % 1000 !== 0 || response.data.result.items.length === 0) {
                    break;
                }
            }

            return events;
        } catch (error) {
            console.error(error);
        }
    }
}
