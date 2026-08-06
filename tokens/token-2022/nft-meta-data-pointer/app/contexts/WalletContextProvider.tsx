import { AppProvider, getDefaultConfig } from '@solana/connector/react';
import { type FC, type ReactNode, useMemo } from 'react';
import { RPC_URL } from '@/utils/anchor';

const WalletContextProvider: FC<{ children: ReactNode }> = ({ children }) => {
    const connectorConfig = useMemo(
        () =>
            getDefaultConfig({
                appName: 'Lumberjack',
                autoConnect: true,
                clusters: [{ id: 'solana:devnet', label: 'Devnet', url: RPC_URL }],
                network: 'devnet',
            }),
        [],
    );

    return <AppProvider connectorConfig={connectorConfig}>{children}</AppProvider>;
};

export default WalletContextProvider;
