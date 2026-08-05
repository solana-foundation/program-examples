import { useKitTransactionSigner } from '@solana/connector/react';
import type { Address } from '@solana/kit';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { dasConnection } from '@/utils/anchor';

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
    const { signer } = useKitTransactionSigner();

    const [nftState, setNftState] = useState<DasNftState | null>(null);

    const getAssetsByOwner = useCallback(async (ownerAddress: Address) => {
        const sortBy = {
            sortBy: 'created',
            sortDirection: 'asc',
        };
        const limit = 1000;
        const page = 1;
        const before = '';
        const after = '';
        const allAssetsOwned = await dasConnection.getAssetsByOwner(ownerAddress, sortBy, limit, page, before, after);

        setNftState(allAssetsOwned as DasNftState);
        console.log(allAssetsOwned);
    }, []);

    useEffect(() => {
        setNftState(null);
        if (!signer) {
            return;
        }

        getAssetsByOwner(signer.address);
    }, [signer, getAssetsByOwner]);

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
