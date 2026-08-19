'use client';

import { useWallet } from '@solana/connector/react';
import { address as toAddress } from '@solana/kit';
import React from 'react';
import { Button } from '@/components/ui/button';
import { useAblTokenProgram } from './abl-token-data-access';

export function AblTokenCreate() {
    const { account } = useWallet();
    const { initToken } = useAblTokenProgram();
    const [mode, setMode] = React.useState<'allow' | 'block' | 'threshold'>('allow');
    const [threshold, setThreshold] = React.useState('100000');
    const [formData, setFormData] = React.useState({
        mintAuthority: account ?? '',
        freezeAuthority: account ?? '',
        permanentDelegate: account ?? '',
        transferHookAuthority: account ?? '',
        name: '',
        symbol: '',
        uri: '',
        decimals: '6',
    });

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        try {
            initToken.mutateAsync({
                decimals: parseInt(formData.decimals, 10),
                mintAuthority: toAddress(formData.mintAuthority),
                freezeAuthority: toAddress(formData.freezeAuthority),
                permanentDelegate: toAddress(formData.permanentDelegate),
                transferHookAuthority: toAddress(formData.transferHookAuthority),
                mode,
                threshold: BigInt(threshold),
                name: formData.name,
                symbol: formData.symbol,
                uri: formData.uri,
            });
        } catch (err) {
            console.error('Invalid form data:', err);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4 max-w-md mx-auto">
            <div className="space-y-2">
                <label className="block">
                    Mint Authority*
                    <input
                        type="text"
                        className="w-full p-2 border rounded"
                        value={formData.mintAuthority}
                        onChange={e => setFormData({ ...formData, mintAuthority: e.target.value })}
                        required
                    />
                </label>

                <label className="block">
                    Freeze Authority*
                    <input
                        type="text"
                        className="w-full p-2 border rounded"
                        value={formData.freezeAuthority}
                        onChange={e => setFormData({ ...formData, freezeAuthority: e.target.value })}
                        required
                    />
                </label>

                <label className="block">
                    Permanent Delegate*
                    <input
                        type="text"
                        className="w-full p-2 border rounded"
                        value={formData.permanentDelegate}
                        onChange={e => setFormData({ ...formData, permanentDelegate: e.target.value })}
                        required
                    />
                </label>

                <label className="block">
                    Transfer Hook Authority*
                    <input
                        type="text"
                        className="w-full p-2 border rounded"
                        value={formData.transferHookAuthority}
                        onChange={e =>
                            setFormData({
                                ...formData,
                                transferHookAuthority: e.target.value,
                            })
                        }
                        required
                    />
                </label>

                <label className="block">
                    Name*
                    <input
                        type="text"
                        className="w-full p-2 border rounded"
                        value={formData.name}
                        onChange={e => setFormData({ ...formData, name: e.target.value })}
                        required
                    />
                </label>

                <label className="block">
                    Symbol*
                    <input
                        type="text"
                        className="w-full p-2 border rounded"
                        value={formData.symbol}
                        onChange={e => setFormData({ ...formData, symbol: e.target.value })}
                        required
                    />
                </label>

                <label className="block">
                    URI*
                    <input
                        type="text"
                        className="w-full p-2 border rounded"
                        value={formData.uri}
                        onChange={e => setFormData({ ...formData, uri: e.target.value })}
                        required
                    />
                </label>

                <label className="block">
                    Decimals*
                    <input
                        type="number"
                        className="w-full p-2 border rounded"
                        value={formData.decimals}
                        onChange={e => setFormData({ ...formData, decimals: e.target.value })}
                        required
                        min="0"
                        max="9"
                    />
                </label>

                <div className="space-y-2">
                    <p className="block">Mode*</p>
                    <div className="flex gap-4">
                        <label>
                            <input
                                type="radio"
                                checked={mode === 'allow'}
                                onChange={() => setMode('allow')}
                                name="mode"
                            />{' '}
                            Allow
                        </label>
                        <label>
                            <input
                                type="radio"
                                checked={mode === 'block'}
                                onChange={() => setMode('block')}
                                name="mode"
                            />{' '}
                            Block
                        </label>
                        <label>
                            <input
                                type="radio"
                                checked={mode === 'threshold'}
                                onChange={() => setMode('threshold')}
                                name="mode"
                            />{' '}
                            Threshold
                        </label>
                    </div>
                </div>

                {mode === 'threshold' && (
                    <label className="block">
                        Threshold Amount
                        <input
                            type="number"
                            className="w-full p-2 border rounded"
                            value={threshold}
                            onChange={e => setThreshold(e.target.value)}
                            min="0"
                        />
                    </label>
                )}
            </div>

            <Button type="submit" disabled={initToken.isPending}>
                Create Token {initToken.isPending && '...'}
            </Button>
        </form>
    );
}

export function AblTokenProgram() {
    const { getProgramAccount } = useAblTokenProgram();

    if (getProgramAccount.isPending) {
        return <span className="loading loading-spinner loading-lg"></span>;
    }
    if (!getProgramAccount.data?.value) {
        return (
            <div className="alert alert-info flex justify-center">
                <span>
                    Program account not found. Make sure you have deployed the program and are on the correct cluster.
                </span>
            </div>
        );
    }
    return (
        <div className={'space-y-6'}>
            <pre>
                {JSON.stringify(
                    getProgramAccount.data.value,
                    (_key, value) => (typeof value === 'bigint' ? value.toString() : value),
                    2,
                )}
            </pre>
        </div>
    );
}

interface WalletEntry {
    address: string;
    mode: 'allow' | 'block';
}

export function AblTokenWalletTable() {
    const [wallets, setWallets] = React.useState<WalletEntry[]>([]);

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
    };

    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault();

        const file = e.dataTransfer.files[0];
        if (file && file.type === 'text/csv') {
            const text = await file.text();
            const rows = text.split('\n');

            const parsed: WalletEntry[] = rows
                .filter(row => row.trim()) // Skip empty rows
                .map(row => {
                    const [address, mode] = row.split(',').map(field => field.trim());
                    return {
                        address,
                        mode: mode.toLowerCase() as 'allow' | 'block',
                    };
                })
                .filter(entry => {
                    // Basic validation
                    try {
                        toAddress(entry.address);
                        return ['allow', 'block'].includes(entry.mode);
                    } catch {
                        return false;
                    }
                });

            setWallets(parsed);
        }
    };

    return (
        <div className="space-y-4">
            <section
                aria-label="CSV file drop zone"
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                className="border-2 border-dashed rounded-lg p-8 text-center hover:border-primary cursor-pointer"
            >
                Drop CSV file here (address,mode)
            </section>

            {wallets.length > 0 && (
                <div className="overflow-x-auto">
                    <table className="table w-full">
                        <thead>
                            <tr>
                                <th>Address</th>
                                <th>Mode</th>
                            </tr>
                        </thead>
                        <tbody>
                            {wallets.map(wallet => (
                                <tr key={wallet.address}>
                                    <td className="font-mono">{wallet.address}</td>
                                    <td>
                                        <span
                                            className={`badge ${wallet.mode === 'allow' ? 'badge-success' : 'badge-error'}`}
                                        >
                                            {wallet.mode}
                                        </span>
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
