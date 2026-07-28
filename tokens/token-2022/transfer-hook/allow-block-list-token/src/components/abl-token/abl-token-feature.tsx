'use client';

import { useWallet } from '@solana/wallet-adapter-react';
import { ellipsify } from '@/lib/utils';
import { AppHero } from '../app-hero';
import { ExplorerLink } from '../cluster/cluster-ui';
import { WalletButton } from '../solana/solana-provider';
import { useAblTokenProgram } from './abl-token-data-access';
import { AblTokenCreate, AblTokenProgram } from './abl-token-ui';

export default function AblTokenFeature() {
    const { publicKey } = useWallet();
    const { programId } = useAblTokenProgram();

    return publicKey ? (
        <div>
            <AppHero title="ABL Token" subtitle={'Run the program by clicking the "Run program" button.'}>
                <p className="mb-6">
                    <ExplorerLink path={`account/${programId}`} label={ellipsify(programId.toString())} />
                </p>
                <AblTokenCreate />
            </AppHero>
            <AblTokenProgram />
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
