import {
    useConnect,
    useConnectedWallet,
    useDisconnect,
    useWallets,
    useWalletStatus,
} from '@solana/kit-plugin-wallet/react';
import { ChevronDown, Copy, ExternalLink, LogOut, Wallet } from 'lucide-react';
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
import { useBalance } from '@/hooks/use-balance';
import { useWallet } from '@/hooks/use-wallet';
import { useCluster } from '@/lib/cluster-context';
import { formatSol, shortenAddress } from '@/lib/format';

export function WalletButton() {
    const { client, address } = useWallet();
    const wallets = useWallets(client);
    const status = useWalletStatus(client);
    const connected = useConnectedWallet(client);
    const { dispatch: connect } = useConnect(client);
    const { dispatch: disconnect } = useDisconnect(client);
    const { getExplorerUrl } = useCluster();
    const balance = useBalance(address ?? undefined);

    const connecting = status === 'connecting';

    async function copyAddress() {
        if (!address) return;
        try {
            await navigator.clipboard.writeText(address);
            toast.success('Address copied');
        } catch {
            // Clipboard unavailable (insecure origin).
        }
    }

    if (connected && address) {
        return (
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="secondary" size="sm">
                        <Wallet className="opacity-70" />
                        {shortenAddress(address)}
                        <ChevronDown className="opacity-60" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64">
                    <DropdownMenuLabel className="space-y-1">
                        <div className="text-xs text-muted-foreground">Balance</div>
                        <div className="text-lg font-bold tabular-nums">
                            {balance.lamports != null ? formatSol(balance.lamports) : '—'}{' '}
                            <span className="text-sm font-normal text-muted-foreground">SOL</span>
                        </div>
                        <div className="pt-1 font-mono text-xs break-all text-muted-foreground">{address}</div>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => void copyAddress()}>
                        <Copy /> Copy address
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                        <a href={getExplorerUrl(`/address/${address}`)} target="_blank" rel="noopener noreferrer">
                            <ExternalLink /> View on Explorer
                        </a>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onClick={() => disconnect()}>
                        <LogOut /> Disconnect
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        );
    }

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="sm" disabled={connecting}>
                    <Wallet className="opacity-70" />
                    {connecting ? 'Connecting…' : 'Connect Wallet'}
                    <ChevronDown className="opacity-60" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuLabel>Connect a wallet</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {wallets.length === 0 && (
                    <DropdownMenuItem disabled>No Wallet Standard wallets detected</DropdownMenuItem>
                )}
                {wallets.map(wallet => (
                    <DropdownMenuItem key={wallet.name} disabled={connecting} onClick={() => connect(wallet)}>
                        {wallet.icon && <img src={wallet.icon} alt="" className="h-4 w-4 rounded-sm" />}
                        <span>{wallet.name}</span>
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
