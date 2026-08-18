'use client';

import { useWallet } from '@solana/connector/react';
import { ellipsify } from '@/lib/utils';
import { AppHero } from '../app-hero';
import { ExplorerLink } from '../cluster/cluster-ui';
import { WalletButton } from '../solana/solana-provider';
import { useAblTokenProgram } from './abl-token-data-access';
import { AblTokenCreate } from './abl-token-ui';

export default function AblTokenFeature() {
    const { account } = useWallet();
    const { programId } = useAblTokenProgram();

    return account ? (
        <div>
            <AppHero title="Create New Token">
                <p className="mb-6">
                    <ExplorerLink path={`account/${programId}`} label={ellipsify(programId.toString())} />
                </p>
                <AblTokenCreate />
            </AppHero>
        </div>
    ) : (
        <div className="max-w-4xl mx-auto">
            <div className="hero py-[64px]">
                <div className="hero-content text-center">
                    <WalletButton />
                </div>
            </div>
        </div>
    );
}
