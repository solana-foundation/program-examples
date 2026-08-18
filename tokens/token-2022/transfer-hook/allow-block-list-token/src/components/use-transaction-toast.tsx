import { isSolanaError, SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE } from '@solana/kit';
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
    return (error: unknown) => {
        // Preflight simulation failures carry the program's simulation logs in the
        // SolanaError's context, the kit equivalent of web3.js's
        // `SendTransactionError.getLogs(connection)`.
        const logs = isSolanaError(error, SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE)
            ? ((error.context as { logs?: readonly string[] }).logs ?? [])
            : [];
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
