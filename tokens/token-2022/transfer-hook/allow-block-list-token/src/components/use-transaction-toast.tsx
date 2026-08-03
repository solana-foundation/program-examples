import type { Connection, SendTransactionError } from '@solana/web3.js';
import { toast } from 'sonner';
import { ExplorerLink } from './cluster/cluster-ui';

export function useTransactionToast() {
    return (signature: string) => {
        toast('Transaction sent', {
            description: <ExplorerLink path={`tx/${signature}`} label="View Transaction" />,
        });
    };
}

export function useTransactionErrorToast() {
    return async (error: Error, connection: Connection) => {
        const logs = await (error as SendTransactionError).getLogs(connection);
        const anchorError = logs.find(l => l.startsWith('Program log: AnchorError occurred'));
        if (anchorError) {
            if (anchorError.includes('WalletBlocked')) {
                toast.error(`Destination wallet is blocked from receiving funds.`);
            } else if (anchorError.includes('WalletNotAllowed')) {
                toast.error(`Destination wallet is not allowed to receive funds.`);
            } else if (anchorError.includes('AmountNotAllowed')) {
                toast.error(`Destination wallet is not authorized to receive this amount.`);
            } else {
                console.log('ERROR: ', error);
                toast.error(`Failed to run program: ${error}`);
            }
        } else {
            console.log('ERROR: ', error);
            toast.error(`Failed to run program: ${error}`);
        }
    };
}
