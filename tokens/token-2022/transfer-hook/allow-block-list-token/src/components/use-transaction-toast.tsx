import { isSolanaError, SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE } from '@solana/kit';
import { toast } from 'sonner';
import {
    ABL_TOKEN_ERROR__AMOUNT_NOT_ALLOWED,
    ABL_TOKEN_ERROR__WALLET_BLOCKED,
    ABL_TOKEN_ERROR__WALLET_NOT_ALLOWED,
} from '@/generated/errors';
import { ExplorerLink } from './cluster/cluster-ui';

const ABL_TOKEN_ERROR_TOASTS = [
    { code: ABL_TOKEN_ERROR__WALLET_BLOCKED, message: 'Destination wallet is blocked from receiving funds.' },
    { code: ABL_TOKEN_ERROR__WALLET_NOT_ALLOWED, message: 'Destination wallet is not allowed to receive funds.' },
    {
        code: ABL_TOKEN_ERROR__AMOUNT_NOT_ALLOWED,
        message: 'Destination wallet is not authorized to receive this amount.',
    },
];

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
            ? (error.context.logs ?? [])
            : [];
        // Anchor prints `Error Number: 6003` alongside the variant name; the numbers come from
        // the generated error constants, so they stay in sync with the program's enum.
        const message = ABL_TOKEN_ERROR_TOASTS.find(({ code }) =>
            logs.some(log => log.includes(`Error Number: ${code}.`)),
        )?.message;
        if (message) {
            toast.error(message);
            return;
        }
        console.log('ERROR: ', error);
        toast.error(`Failed to run program: ${error}`);
    };
}
