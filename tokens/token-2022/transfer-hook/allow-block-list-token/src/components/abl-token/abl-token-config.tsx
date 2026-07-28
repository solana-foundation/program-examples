'use client';

import { useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import React from 'react';
import { Button } from '@/components/ui/button';
import { ellipsify } from '@/lib/utils';
import { AppHero } from '../app-hero';
import { ExplorerLink } from '../cluster/cluster-ui';
import { WalletButton } from '../solana/solana-provider';
import { useAblTokenProgram } from './abl-token-data-access';

export default function AblTokenConfig() {
    const { publicKey } = useWallet();
    const { programId, getConfig, getAbWallets } = useAblTokenProgram();

    const config = getConfig.data;
    let abWallets = getAbWallets.data;

    const handleWalletListUpdate = React.useCallback(async () => {
        await getAbWallets.refetch();
        abWallets = getAbWallets.data;
    }, [getAbWallets.refetch, getAbWallets.data]);

    return publicKey ? (
        <div>
            <AppHero title="ABL Token Config" subtitle={''}>
                <p className="mb-6">
                    <ExplorerLink path={`account/${programId}`} label={ellipsify(programId.toString())} />
                </p>
                {config ? (
                    <>
                        <div className="mb-16">
                            <AblTokenConfigList abWallets={abWallets} />
                        </div>
                        <div className="mb-16">
                            {config.authority.equals(publicKey) ? (
                                <AblTokenConfigListChange onWalletListUpdate={handleWalletListUpdate} />
                            ) : (
                                <div className="text-destructive font-semibold">
                                    UNAUTHORIZED: Only the config authority can modify the wallet list
                                </div>
                            )}
                        </div>
                    </>
                ) : (
                    <AblTokenConfigCreate />
                )}
            </AppHero>
        </div>
    ) : (
        <div className="max-w-4xl mx-auto">
            <div className="hero py-[64px]">
                <div className="hero-content text-center">
                    <WalletButton className="btn btn-primary" />
                </div>
            </div>
        </div>
    );
}

export function AblTokenConfigCreate() {
    const { initConfig, getConfig } = useAblTokenProgram();
    const { publicKey } = useWallet();

    const handleCreate = async () => {
        if (!publicKey) return;
        try {
            await initConfig.mutateAsync();
            // Refresh the config list
            getConfig.refetch();
        } catch (err) {
            console.error('Failed to create config:', err);
        }
    };

    return (
        <div className="space-y-4">
            <h2 className="text-2xl font-bold">Create ABL Token Config</h2>
            <p className="text-gray-600">
                Initialize the ABL Token configuration. This will set up the necessary accounts for managing allow/block
                lists.
            </p>
            <Button onClick={handleCreate} disabled={initConfig.isPending}>
                {initConfig.isPending ? 'Creating...' : 'Create Config'}
            </Button>
        </div>
    );
}

export function AblTokenConfigList({
    abWallets,
}: {
    abWallets:
        | {
              publicKey: PublicKey;
              account: { wallet: PublicKey; allowed: boolean };
          }[]
        | undefined;
}) {
    return (
        <div className="space-y-4">
            <h2 className="text-2xl font-bold">ABL Token Config List</h2>
            {abWallets && abWallets.length > 0 ? (
                <div className="overflow-x-auto">
                    <table className="table w-full">
                        <thead>
                            <tr>
                                <th>Wallet Address</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {abWallets.map(wallet => (
                                <tr key={wallet.publicKey.toString()}>
                                    <td className="font-mono">{wallet.account.wallet.toString()}</td>
                                    <td>
                                        <span
                                            className={`badge ${wallet.account.allowed ? 'badge-success' : 'badge-error'}`}
                                        >
                                            {wallet.account.allowed ? 'Allowed' : 'Blocked'}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ) : (
                <p>No wallets configured yet.</p>
            )}
        </div>
    );
}

interface WalletChange {
    address: string;
    mode: 'allow' | 'block' | 'remove';
    status?: 'pending' | 'success' | 'error';
    error?: string;
}

export function AblTokenConfigListChange({ onWalletListUpdate }: { onWalletListUpdate: () => void }) {
    const { getAbWallets, processBatchWallets } = useAblTokenProgram();
    const [isEditing, setIsEditing] = React.useState(false);
    const [walletChanges, setWalletChanges] = React.useState<WalletChange[]>([]);
    const [isProcessing, setIsProcessing] = React.useState(false);
    const existingWallets = React.useMemo(() => {
        const wallets = getAbWallets.data || [];
        return new Map(wallets.map(w => [w.account.wallet.toString(), w.account.allowed]));
    }, [getAbWallets.data]);

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
    };

    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (file && file.type === 'text/csv') {
            const text = await file.text();
            const rows = text.split('\n');

            // Create a Set of existing wallet addresses for deduplication
            const existingAddresses = new Set([
                ...Array.from(existingWallets.keys()),
                ...walletChanges.map(w => w.address),
            ]);

            const parsed: WalletChange[] = rows
                .filter(row => row.trim())
                .map(row => {
                    const [address, mode] = row.split(',').map(field => field.trim());
                    return {
                        address,
                        mode: mode.toLowerCase() as 'allow' | 'block' | 'remove',
                    };
                })
                .filter(entry => {
                    try {
                        new PublicKey(entry.address);
                        return ['allow', 'block', 'remove'].includes(entry.mode);
                    } catch {
                        return false;
                    }
                })
                .filter(entry => {
                    // Only allow 'remove' for existing wallets
                    if (entry.mode === 'remove') {
                        return existingWallets.has(entry.address);
                    }
                    return true;
                })
                // Deduplicate entries, keeping the last occurrence of each address
                .reduce((acc, entry) => {
                    const existingIndex = acc.findIndex(w => w.address === entry.address);
                    if (existingIndex >= 0) {
                        acc[existingIndex] = entry;
                    } else {
                        acc.push(entry);
                    }
                    return acc;
                }, [] as WalletChange[])
                // Filter out entries that already exist in the current state
                .filter(entry => !existingAddresses.has(entry.address));

            if (parsed.length > 0) {
                setWalletChanges(prev => [...prev, ...parsed]);
                setIsEditing(true);
            }
        }
    };

    const handleAddWallet = () => {
        setWalletChanges(prev => [...prev, { address: '', mode: 'allow' }]);
        setIsEditing(true);
    };

    const handleUpdateWallet = (index: number, field: keyof WalletChange, value: string) => {
        setWalletChanges(prev => prev.map((wallet, i) => (i === index ? { ...wallet, [field]: value } : wallet)));
    };

    const handleRemoveWallet = (index: number) => {
        setWalletChanges(prev => prev.filter((_, i) => i !== index));
    };

    const processWallets = async () => {
        setIsProcessing(true);
        const batchSize = 10;
        const batches = [];

        for (let i = 0; i < walletChanges.length; i += batchSize) {
            batches.push(walletChanges.slice(i, i + batchSize));
        }

        for (const batch of batches) {
            try {
                await processBatchWallets.mutateAsync({
                    wallets: batch.map(w => ({
                        wallet: new PublicKey(w.address),
                        mode: w.mode,
                    })),
                });

                // Mark batch as successful
                setWalletChanges(prev =>
                    prev.map(wallet =>
                        batch.some(b => b.address === wallet.address) ? { ...wallet, status: 'success' } : wallet,
                    ),
                );
            } catch (error: unknown) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
                // Mark batch as failed
                setWalletChanges(prev =>
                    prev.map(wallet =>
                        batch.some(b => b.address === wallet.address)
                            ? { ...wallet, status: 'error', error: errorMessage }
                            : wallet,
                    ),
                );
            }
        }

        // Refresh wallet list and clear successful changes
        await getAbWallets.refetch();
        setWalletChanges(prev => prev.filter(w => w.status !== 'success'));
        setIsProcessing(false);
        // Notify parent component to update the wallet list
        onWalletListUpdate();
    };

    return (
        <div className="space-y-4">
            <div className="flex justify-between items-center">
                <h2 className="text-2xl font-bold">Edit Wallet List</h2>
                <div className="space-x-2">
                    <Button onClick={handleAddWallet} disabled={isProcessing}>
                        Add Wallet
                    </Button>
                    {isEditing && (
                        <Button onClick={processWallets} disabled={isProcessing || walletChanges.length === 0}>
                            {isProcessing ? 'Processing...' : 'Apply Changes'}
                        </Button>
                    )}
                </div>
            </div>

            <section
                aria-label="CSV file drop zone"
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                className="border-2 border-dashed rounded-lg p-8 text-center hover:border-primary cursor-pointer mb-4"
            >
                Drop CSV file here (address,mode)
                <p className="text-sm text-gray-500 mt-2">
                    Mode can be: allow, block, or remove (remove only works for existing wallets)
                </p>
            </section>

            {walletChanges.length > 0 && (
                <div className="overflow-x-auto">
                    <table className="table w-full">
                        <thead>
                            <tr>
                                <th>Wallet Address</th>
                                <th>Mode</th>
                                <th>Status</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {walletChanges.map((wallet, index) => (
                                <tr key={wallet.address || String(index)}>
                                    <td>
                                        <input
                                            type="text"
                                            className="input input-bordered w-full"
                                            value={wallet.address}
                                            onChange={e => handleUpdateWallet(index, 'address', e.target.value)}
                                            placeholder="Wallet address"
                                            disabled={isProcessing}
                                        />
                                    </td>
                                    <td>
                                        <select
                                            className="select select-bordered w-full"
                                            value={wallet.mode}
                                            onChange={e =>
                                                handleUpdateWallet(
                                                    index,
                                                    'mode',
                                                    e.target.value as 'allow' | 'block' | 'remove',
                                                )
                                            }
                                            disabled={isProcessing}
                                        >
                                            <option value="allow">Allow</option>
                                            <option value="block">Block</option>
                                            {existingWallets.has(wallet.address) && (
                                                <option value="remove">Remove</option>
                                            )}
                                        </select>
                                    </td>
                                    <td>
                                        {wallet.status === 'success' && <span className="badge badge-success">✓</span>}
                                        {wallet.status === 'error' && (
                                            <span className="badge badge-error" title={wallet.error}>
                                                ✗
                                            </span>
                                        )}
                                    </td>
                                    <td>
                                        <Button
                                            onClick={() => handleRemoveWallet(index)}
                                            disabled={isProcessing}
                                            variant="ghost"
                                        >
                                            Remove
                                        </Button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
