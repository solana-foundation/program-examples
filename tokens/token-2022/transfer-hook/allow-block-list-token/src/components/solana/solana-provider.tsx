'use client';

import {
    AppProvider,
    getDefaultConfig,
    useConnectWallet,
    useDisconnectWallet,
    useWallet,
    useWalletConnectors,
    useWalletInfo,
    type SolanaCluster as ConnectorCluster,
    type SolanaClusterId,
} from '@solana/connector/react';
import { ChevronDown, LogOut, Wallet } from 'lucide-react';
import { type ReactNode, useMemo } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ellipsify } from '@/lib/utils';
import { ClusterNetwork, useCluster, type SolanaCluster } from '../cluster/cluster-data-access';

function isLocalEndpoint(endpoint: string): boolean {
    try {
        const { hostname } = new URL(endpoint);
        return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
    } catch {
        return false;
    }
}

function connectorNetworkFor(cluster: SolanaCluster): 'devnet' | 'localnet' | 'mainnet' | 'testnet' {
    switch (cluster.network) {
        case ClusterNetwork.Devnet:
            return 'devnet';
        case ClusterNetwork.Testnet:
            return 'testnet';
        case ClusterNetwork.Mainnet:
            return 'mainnet';
        default:
            return isLocalEndpoint(cluster.endpoint) ? 'localnet' : 'devnet';
    }
}

function connectorClusterIdFor(cluster: SolanaCluster): SolanaClusterId {
    switch (connectorNetworkFor(cluster)) {
        case 'devnet':
            return 'solana:devnet';
        case 'testnet':
            return 'solana:testnet';
        case 'mainnet':
            return 'solana:mainnet';
        default:
            return 'solana:localnet';
    }
}

export function WalletButton() {
    const { account, isConnected, isConnecting } = useWallet();
    const connectors = useWalletConnectors();
    const { connect, isConnecting: connectPending } = useConnectWallet();
    const { disconnect, isDisconnecting } = useDisconnectWallet();
    const walletInfo = useWalletInfo();

    const pending = isConnecting || connectPending || isDisconnecting;

    async function handleConnect(connectorId: (typeof connectors)[number]['id']) {
        try {
            await connect(connectorId);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Wallet connection failed');
        }
    }

    async function handleDisconnect() {
        try {
            await disconnect();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Wallet disconnect failed');
        }
    }

    if (isConnected && account) {
        return (
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button disabled={pending} size="sm" variant="secondary">
                        <Wallet className="opacity-70" />
                        {ellipsify(account, 4)}
                        <ChevronDown className="opacity-60" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64">
                    <DropdownMenuLabel className="space-y-1">
                        <div className="text-sm">{walletInfo.name ?? 'Connected wallet'}</div>
                        <div className="font-mono text-xs text-muted-foreground break-all">{account}</div>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        disabled={pending}
                        onClick={() => void handleDisconnect()}
                    >
                        <LogOut className="h-4 w-4" />
                        Disconnect
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        );
    }

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button disabled={pending} size="sm" variant="secondary">
                    <Wallet className="opacity-70" />
                    {pending ? 'Connecting…' : 'Connect Wallet'}
                    <ChevronDown className="opacity-60" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel>Connect wallet</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {connectors.length === 0 && (
                    <DropdownMenuItem disabled>No Wallet Standard wallets detected</DropdownMenuItem>
                )}
                {connectors.map(walletConnector => (
                    <DropdownMenuItem
                        disabled={pending || !walletConnector.ready}
                        key={walletConnector.id}
                        onClick={() => void handleConnect(walletConnector.id)}
                    >
                        {walletConnector.icon && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={walletConnector.icon} alt="" className="h-4 w-4 rounded-sm" />
                        )}
                        <span>{walletConnector.name}</span>
                        {!walletConnector.ready && (
                            <span className="ml-auto text-xs text-muted-foreground">Not ready</span>
                        )}
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

export function SolanaProvider({ children }: { children: ReactNode }) {
    const { cluster } = useCluster();

    const connectorConfig = useMemo(() => {
        const connectorCluster: ConnectorCluster = {
            id: connectorClusterIdFor(cluster),
            label: cluster.name,
            url: cluster.endpoint,
        };
        return getDefaultConfig({
            appName: 'ABL Token',
            autoConnect: true,
            clusters: [connectorCluster],
            enableMobile: true,
            network: connectorNetworkFor(cluster),
            persistClusterSelection: false,
        });
    }, [cluster]);

    // Keyed on the endpoint so switching clusters reinitializes the wallet connector against
    // the new chain instead of reusing the previous one's session.
    return (
        <AppProvider key={cluster.endpoint} connectorConfig={connectorConfig}>
            {children}
        </AppProvider>
    );
}
