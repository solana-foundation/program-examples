import { useWallet } from '@solana/wallet-adapter-react';
import type { PublicKey } from '@solana/web3.js';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { CONNECTION } from '@/utils/anchor';

interface DasNftItem {
    id: string;
    authorities: Array<{ address: string } | string>;
    content: {
        metadata: { name: string };
        links: { image: string };
    };
}

interface DasNftState {
    items: DasNftItem[];
}

const NftContext = createContext<{
    nftState: DasNftState | null;
}>({
    nftState: null,
});

export const useNftState = () => useContext(NftContext);

export const NftProvider = ({ children }: { children: React.ReactNode }) => {
    const { publicKey } = useWallet();

    const [nftState, setNftState] = useState<DasNftState | null>(null);

    const getAssetsByOwner = useCallback(async (ownerAddress: PublicKey) => {
        const sortBy = {
            sortBy: 'created',
            sortDirection: 'asc',
        };
        const limit = 1000;
        const page = 1;
        const before = '';
        const after = '';
        const allAssetsOwned = await CONNECTION.getAssetsByOwner(
            ownerAddress.toBase58(),
            sortBy,
            limit,
            page,
            before,
            after,
        );

        setNftState(allAssetsOwned as DasNftState);
        console.log(allAssetsOwned);
    }, []);

    useEffect(() => {
        setNftState(null);
        if (!publicKey) {
            return;
        }

        getAssetsByOwner(publicKey);
    }, [publicKey, getAssetsByOwner]);

    return (
        <NftContext.Provider
            value={{
                nftState: nftState,
            }}
        >
            {children}
        </NftContext.Provider>
    );
};
