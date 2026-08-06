import { useKitTransactionSigner } from '@solana/connector/react';
import type { Address } from '@solana/kit';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { type DasAssetList, dasRpc } from '@/utils/das';

const NftContext = createContext<{
    nftState: DasAssetList | null;
}>({
    nftState: null,
});

export const useNftState = () => useContext(NftContext);

export const NftProvider = ({ children }: { children: React.ReactNode }) => {
    const { signer } = useKitTransactionSigner();

    const [nftState, setNftState] = useState<DasAssetList | null>(null);

    const getAssetsByOwner = useCallback(async (ownerAddress: Address) => {
        if (!dasRpc) {
            window.alert('Set NEXT_PUBLIC_DAS_RPC to a Digital Asset Standard endpoint to load NFTs.');
            return;
        }

        const allAssetsOwned = await dasRpc
            .getAssetsByOwner({
                ownerAddress,
                sortBy: { sortBy: 'created', sortDirection: 'asc' },
                limit: 1000,
                page: 1,
            })
            .send();

        setNftState(allAssetsOwned);
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
