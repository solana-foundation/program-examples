'use client';

import { BN } from '@anchor-lang/core';
import { useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { useParams } from 'next/navigation';
import React from 'react';
import { Button } from '@/components/ui/button';
import { WalletButton } from '../solana/solana-provider';
import { useAblTokenProgram, useGetToken } from './abl-token-data-access';

interface TokenInfo {
    address: string;
    name: string | undefined;
    symbol: string | undefined;
    uri: string | undefined;
    decimals: number;
    supply: number;
    mintAuthority: PublicKey | null;
    freezeAuthority: PublicKey | null;
    permanentDelegate: PublicKey | null;
    mode: string | null;
    threshold: string | null;
    transferHookProgramId: PublicKey | null;
    isTransferHookEnabled: boolean;
    isTransferHookSet: boolean;
}

function TokenInfo({ tokenAddress }: { tokenAddress: string }) {
    const { attachToExistingToken } = useAblTokenProgram();
    const tokenInfo = useGetToken(new PublicKey(tokenAddress));
    return (
        <div className="bg-base-200 p-6 rounded-lg">
            <h2 className="text-2xl font-bold mb-4">Token Information</h2>
            {tokenInfo ? (
                <div className="grid grid-cols-2 gap-4">
                    <div>Address: {tokenAddress}</div>
                    <div>Name: {tokenInfo.data?.name}</div>
                    <div>Symbol: {tokenInfo.data?.symbol}</div>
                    <div>Decimals: {tokenInfo.data?.decimals}</div>
                    <div>URI: {tokenInfo.data?.uri}</div>
                    <div>Supply: {tokenInfo.data?.supply}</div>
                    <div>Mint Authority: {tokenInfo.data?.mintAuthority?.toString()}</div>
                    <div>Freeze Authority: {tokenInfo.data?.freezeAuthority?.toString()}</div>
                    <div>Permanent Delegate: {tokenInfo.data?.permanentDelegate?.toString()}</div>
                    <br />
                    <div>
                        <h3 className="text-xl font-bold mb-2">ABL Token</h3>
                        <div>Mode: {tokenInfo.data?.mode}</div>
                        <div>Threshold: {tokenInfo.data?.threshold?.toString()}</div>
                        {tokenInfo.data?.isTransferHookEnabled ? (
                            tokenInfo.data?.isTransferHookSet ? (
                                <div>TxHook: Enabled and Set ✅</div>
                            ) : (
                                <div>
                                    TxHook: Enabled.{' '}
                                    <Button
                                        onClick={() =>
                                            attachToExistingToken
                                                .mutateAsync({ mint: new PublicKey(tokenAddress) })
                                                .then()
                                        }
                                    >
                                        Set
                                    </Button>
                                </div>
                            )
                        ) : (
                            <div>TxHook: Not enabled ❌</div>
                        )}
                    </div>
                </div>
            ) : (
                <p>No token information available.</p>
            )}
        </div>
    );
}

function TokenManagement({ tokenInfo }: { tokenInfo: TokenInfo }) {
    const { publicKey } = useWallet();
    const { changeMode, mintTo } = useAblTokenProgram();
    const [mode, setMode] = React.useState<'Allow' | 'Block' | 'Mixed'>(tokenInfo.mode as 'Allow' | 'Block' | 'Mixed');
    const [threshold, setThreshold] = React.useState<string | undefined>(tokenInfo.threshold ?? undefined);
    const [destinationWallet, setDestinationWallet] = React.useState('');

    const handleApplyChanges = async () => {
        if (!publicKey || !tokenInfo) return;

        try {
            await changeMode.mutateAsync({
                mode,
                threshold: threshold === undefined ? new BN(0) : new BN(threshold),
                mint: new PublicKey(tokenInfo.address),
            });
        } catch (err) {
            console.error('Failed to apply changes:', err);
        }
    };

    const [mintAmount, setMintAmount] = React.useState('0');

    const handleMint = async () => {
        if (!publicKey || !tokenInfo) return;

        try {
            const recipient = destinationWallet.trim() ? new PublicKey(destinationWallet.trim()) : publicKey;
            await mintTo.mutateAsync({
                mint: new PublicKey(tokenInfo.address),
                amount: new BN(mintAmount),
                recipient,
            });
            console.log('Minted successfully');
        } catch (err) {
            console.error('Failed to mint tokens:', err);
        }
    };

    return (
        <div className="bg-base-200 p-6 rounded-lg">
            <h2 className="text-2xl font-bold mb-4">Token Management</h2>
            <div className="space-y-4">
                <div>
                    {tokenInfo.isTransferHookSet && (
                        <div>
                            <p className="block mb-2">Mode</p>
                            <div className="flex gap-4">
                                <label>
                                    <input
                                        type="radio"
                                        checked={mode === 'Allow'}
                                        onChange={() => {
                                            setMode('Allow');
                                            setThreshold(tokenInfo.threshold ?? undefined);
                                        }}
                                        name="mode"
                                    />{' '}
                                    Allow
                                </label>
                                <label>
                                    <input
                                        type="radio"
                                        checked={mode === 'Block'}
                                        onChange={() => {
                                            setMode('Block');
                                            setThreshold(tokenInfo.threshold ?? undefined);
                                        }}
                                        name="mode"
                                    />{' '}
                                    Block
                                </label>
                                <label>
                                    <input
                                        type="radio"
                                        checked={mode === 'Mixed'}
                                        onChange={() => setMode('Mixed')}
                                        name="mode"
                                    />{' '}
                                    Mixed
                                </label>
                            </div>

                            {mode === 'Mixed' && (
                                <div>
                                    <label htmlFor="threshold-amount" className="block mb-2">
                                        Threshold Amount
                                    </label>
                                    <input
                                        id="threshold-amount"
                                        type="number"
                                        className="w-full p-2 border rounded"
                                        value={threshold}
                                        onChange={e => setThreshold(e.target.value)}
                                        min="0"
                                    />
                                </div>
                            )}

                            <div className="mt-4">
                                <Button
                                    onClick={handleApplyChanges}
                                    disabled={
                                        mode === tokenInfo.mode &&
                                        (threshold === tokenInfo.threshold ||
                                            (threshold === undefined && tokenInfo.threshold === null))
                                    }
                                >
                                    Apply Changes
                                </Button>
                            </div>
                        </div>
                    )}
                </div>

                <div className="mt-8">
                    <h3 className="text-xl font-bold mb-2">Mint New Tokens</h3>
                    <div className="space-y-4">
                        <div>
                            <label htmlFor="destination-wallet" className="block mb-2">
                                Destination Wallet
                            </label>
                            <input
                                id="destination-wallet"
                                type="text"
                                className="w-full p-2 border rounded"
                                value={destinationWallet}
                                onChange={e => setDestinationWallet(e.target.value)}
                                placeholder="Enter destination wallet address"
                            />
                        </div>
                        <div className="flex items-center gap-4">
                            <input
                                type="number"
                                className="w-full p-2 border rounded"
                                value={mintAmount}
                                onChange={e => setMintAmount(e.target.value)}
                                min="0"
                                placeholder="Amount to mint"
                            />
                            <Button onClick={handleMint}>Mint Tokens</Button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default function ManageTokenDetail() {
    const { publicKey } = useWallet();
    const params = useParams();
    const tokenAddress = params?.address as string;
    const tokenQuery = useGetToken(new PublicKey(tokenAddress));

    const tokenInfo = React.useMemo(() => {
        if (!tokenQuery?.data || !tokenAddress) return null;
        return {
            ...tokenQuery.data,
            address: tokenAddress,
            supply: 0, // TODO: Get supply from token account
        };
    }, [tokenQuery?.data, tokenAddress]);

    if (!publicKey) {
        return (
            <div className="hero py-[64px]">
                <div className="hero-content text-center">
                    <WalletButton />
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-8">
            {tokenQuery?.isLoading ? (
                <p>Loading token information...</p>
            ) : tokenQuery?.isError ? (
                <p>Error loading token information. Please check the token address.</p>
            ) : (
                <>
                    <TokenInfo tokenAddress={tokenAddress} />
                    {tokenInfo && <TokenManagement tokenInfo={tokenInfo} />}
                </>
            )}
        </div>
    );
}
