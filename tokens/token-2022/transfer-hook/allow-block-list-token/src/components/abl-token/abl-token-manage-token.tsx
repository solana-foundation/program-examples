'use client';

import { useWallet } from '@solana/wallet-adapter-react';
import { AppHero } from '../app-hero';
import { WalletButton } from '../solana/solana-provider';
import ManageTokenInput from './abl-token-manage-token-input';
export default function AblTokenFeature() {
    const { publicKey } = useWallet();

    return publicKey ? (
        <div>
            <AppHero title="Manage Token">
                <ManageTokenInput />
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
