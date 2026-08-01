import { type Address, address } from '@solana/kit';
import { useConnectedWallet } from '@solana/kit-plugin-wallet/react';

import { useAppClient } from '@/lib/client-provider';

/** The app client plus the connected wallet (signer + address), or nulls when disconnected. */
export function useWallet() {
    const client = useAppClient();
    const connected = useConnectedWallet(client);
    const walletAddress = connected ? (address(connected.account.address) as Address) : null;
    return { address: walletAddress, client, connected, signer: connected?.signer ?? null };
}
