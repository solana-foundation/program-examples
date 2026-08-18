'use client';

import { useWallet } from '@solana/connector/react';
import { redirect } from 'next/navigation';
import { WalletButton } from '../solana/solana-provider';

export default function AccountListFeature() {
    const { account } = useWallet();

    if (account) {
        return redirect(`/account/${account.toString()}`);
    }

    return (
        <div className="hero py-[64px]">
            <div className="hero-content text-center">
                <WalletButton />
            </div>
        </div>
    );
}
