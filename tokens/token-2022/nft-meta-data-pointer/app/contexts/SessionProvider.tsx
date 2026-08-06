import { SessionWalletProvider, useSessionKeyManager } from '@magicblock-labs/gum-react-sdk';
import { useKitTransactionSigner } from '@solana/connector/react';
import type { AnchorWallet } from '@solana/wallet-adapter-react';
import { Connection, PublicKey, Transaction, type VersionedTransaction } from '@solana/web3.js';
import { useMemo } from 'react';
import { RPC_URL } from '@/utils/anchor';
import { signLegacyTransactionWithKitSigner } from '@/utils/legacyBridge';

interface SessionProviderProps {
    children: React.ReactNode;
}

// gum-sdk's useSessionKeyManager requires an AnchorWallet-shaped signer backed
// by @solana/web3.js. This adapts the one connected kit signer into that shape.
const SessionProvider: React.FC<SessionProviderProps> = ({ children }) => {
    const { signer } = useKitTransactionSigner();
    const connection = useMemo(() => new Connection(RPC_URL, 'confirmed'), []);
    const cluster = 'devnet'; // or "mainnet-beta", "testnet", "localnet"

    const anchorWallet = useMemo((): AnchorWallet | undefined => {
        if (!signer) return undefined;

        function assertLegacyTransaction(
            transaction: Transaction | VersionedTransaction,
        ): asserts transaction is Transaction {
            if (!(transaction instanceof Transaction)) {
                throw new Error('The session-key bridge only supports legacy Transactions, not VersionedTransactions');
            }
        }

        return {
            publicKey: new PublicKey(signer.address),
            signTransaction: async <T extends Transaction | VersionedTransaction>(transaction: T): Promise<T> => {
                assertLegacyTransaction(transaction);
                return (await signLegacyTransactionWithKitSigner(signer, transaction)) as T;
            },
            signAllTransactions: async <T extends Transaction | VersionedTransaction>(
                transactions: T[],
            ): Promise<T[]> => {
                return Promise.all(
                    transactions.map(async transaction => {
                        assertLegacyTransaction(transaction);
                        return (await signLegacyTransactionWithKitSigner(signer, transaction)) as T;
                    }),
                );
            },
        };
    }, [signer]);

    const sessionWallet = useSessionKeyManager(anchorWallet as AnchorWallet, connection, cluster);

    return <SessionWalletProvider sessionWallet={sessionWallet}>{children}</SessionWalletProvider>;
};

export default SessionProvider;
