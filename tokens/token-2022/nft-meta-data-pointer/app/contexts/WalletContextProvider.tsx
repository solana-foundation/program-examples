import { AppProvider, getDefaultConfig } from '@solana/connector/react';
import { type FC, type ReactNode, useMemo } from 'react';

const WalletContextProvider: FC<{ children: ReactNode }> = ({ children }) => {
    const connectorConfig = useMemo(
        () =>
            getDefaultConfig({
                appName: 'Lumberjack',
                autoConnect: true,
                clusters: [{ id: 'solana:devnet', label: 'Devnet', url: 'https://api.devnet.solana.com' }],
                network: 'devnet',
            }),
        [],
    );

    return <AppProvider connectorConfig={connectorConfig}>{children}</AppProvider>;
};

export default WalletContextProvider;
