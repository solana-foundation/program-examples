'use client';

import { useKitTransactionSigner, useSolanaClient, useWallet } from '@solana/connector/react';
import { airdropFactory, lamports, type Address } from '@solana/kit';
import {
    fetchMint,
    findAssociatedTokenPda,
    getCreateAssociatedTokenIdempotentInstructionAsync,
    getTransferCheckedWithTransferHookInstructionAsync,
    TOKEN_2022_PROGRAM_ADDRESS,
    TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token-2022';
import { getTransferSolInstruction } from '@solana-program/system';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSendInstruction } from '@/hooks/use-send-instruction';
import { useCluster } from '../cluster/cluster-data-access';
import { useTransactionErrorToast, useTransactionToast } from '../use-transaction-toast';

const LAMPORTS_PER_SOL = 1_000_000_000;

// `useGetBalance`/`useGetTokenAccounts`/`useGetSignatures` back the generic `/account/[address]`
// page, which needs to read ANY address, not just the connected wallet's - connector's
// `useBalance`/`useTokens`/`useTransactions` don't take an address parameter (they're scoped to
// the connected wallet only), so they aren't a fit here. `useSolanaClient` still replaces the
// custom RPC-construction hook that used to live in cluster-data-access.tsx.
export function useGetBalance({ address }: { address: Address }) {
    const { client } = useSolanaClient();
    const { cluster } = useCluster();

    return useQuery({
        enabled: client !== null,
        queryKey: ['get-balance', { endpoint: cluster.endpoint, address }],
        queryFn: async () => Number((await client!.rpc.getBalance(address).send()).value),
    });
}

export function useGetSignatures({ address }: { address: Address }) {
    const { client } = useSolanaClient();
    const { cluster } = useCluster();

    return useQuery({
        enabled: client !== null,
        queryKey: ['get-signatures', { endpoint: cluster.endpoint, address }],
        queryFn: () => client!.rpc.getSignaturesForAddress(address).send(),
    });
}

export function useSendTokens() {
    const { client } = useSolanaClient();
    const { account } = useWallet();
    const { signer } = useKitTransactionSigner();
    const sendInstruction = useSendInstruction();
    const transactionToast = useTransactionToast();
    const transactionErrorToast = useTransactionErrorToast();

    return useMutation({
        mutationFn: async (args: { mint: Address; destination: Address; amount: number }) => {
            if (!signer || !account || !client) throw new Error('No public key found');
            const { mint, destination, amount } = args;

            const [mintAccount, [ataDestination], [ataSource]] = await Promise.all([
                fetchMint(client.rpc, mint),
                findAssociatedTokenPda({ owner: destination, mint, tokenProgram: TOKEN_2022_PROGRAM_ADDRESS }),
                findAssociatedTokenPda({ owner: account, mint, tokenProgram: TOKEN_2022_PROGRAM_ADDRESS }),
            ]);

            const createAtaIx = await getCreateAssociatedTokenIdempotentInstructionAsync({
                payer: signer,
                owner: destination,
                mint,
                tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
            });

            // Resolves the hook's extra accounts (both sender's and receiver's ab_wallet PDAs)
            // by reading the mint's on-chain extra-account-metas list, instead of hardcoding
            // this program's PDA seed convention client-side.
            const transferIx = await getTransferCheckedWithTransferHookInstructionAsync(
                client,
                {
                    source: ataSource,
                    mint,
                    destination: ataDestination,
                    authority: signer,
                    amount: BigInt(amount),
                    decimals: mintAccount.data.decimals,
                },
                { tokenProgram: TOKEN_2022_PROGRAM_ADDRESS },
            );

            return sendInstruction([createAtaIx, transferIx], signer);
        },
        onSuccess: signature => {
            transactionToast(signature);
        },
        onError: error => {
            transactionErrorToast(error);
        },
    });
}

export function useGetTokenAccounts({ address }: { address: Address }) {
    const { client } = useSolanaClient();
    const { cluster } = useCluster();

    return useQuery({
        enabled: client !== null,
        queryKey: ['get-token-accounts', { endpoint: cluster.endpoint, address }],
        queryFn: async () => {
            const [tokenAccounts, token2022Accounts] = await Promise.all([
                client!.rpc
                    .getTokenAccountsByOwner(address, { programId: TOKEN_PROGRAM_ADDRESS }, { encoding: 'jsonParsed' })
                    .send(),
                client!.rpc
                    .getTokenAccountsByOwner(
                        address,
                        { programId: TOKEN_2022_PROGRAM_ADDRESS },
                        { encoding: 'jsonParsed' },
                    )
                    .send(),
            ]);
            return [...tokenAccounts.value, ...token2022Accounts.value];
        },
    });
}

export function useTransferSol({ address }: { address: Address }) {
    const { cluster } = useCluster();
    const { signer } = useKitTransactionSigner();
    const sendInstruction = useSendInstruction();
    const client = useQueryClient();

    return useMutation({
        mutationKey: ['transfer-sol', { endpoint: cluster.endpoint, address }],
        mutationFn: async (input: { destination: Address; amount: number }) => {
            if (!signer) throw new Error('Wallet not connected');
            // The connected wallet is the only account we can actually sign for - this hook is
            // only meaningful when the page being viewed (`address`) is the connected wallet's
            // own account.
            if (signer.address !== address) {
                throw new Error('Connected wallet does not match the account being viewed');
            }
            try {
                const ix = getTransferSolInstruction({
                    source: signer,
                    destination: input.destination,
                    amount: lamports(BigInt(Math.round(input.amount * LAMPORTS_PER_SOL))),
                });
                const signature = await sendInstruction(ix, signer);
                console.log(signature);
                return signature;
            } catch (error: unknown) {
                console.log('error', `Transaction failed! ${error}`);
                return;
            }
        },
        onSuccess: signature => {
            if (signature) {
                // TODO: Add back Toast
                // transactionToast(signature)
                console.log('Transaction sent', signature);
            }
            return Promise.all([
                client.invalidateQueries({
                    queryKey: ['get-balance', { endpoint: cluster.endpoint, address }],
                }),
                client.invalidateQueries({
                    queryKey: ['get-signatures', { endpoint: cluster.endpoint, address }],
                }),
            ]);
        },
        onError: error => {
            // TODO: Add Toast
            console.error(`Transaction failed! ${error}`);
        },
    });
}

export function useRequestAirdrop({ address }: { address: Address }) {
    const { client } = useSolanaClient();
    const { cluster } = useCluster();
    const queryClient = useQueryClient();

    return useMutation({
        mutationKey: ['airdrop', { endpoint: cluster.endpoint, address }],
        mutationFn: async (amount: number = 1) => {
            if (!client) throw new Error('Solana client not ready');
            const airdrop = airdropFactory({ rpc: client.rpc, rpcSubscriptions: client.rpcSubscriptions });
            // Requests and confirms in one call, unlike a bare `rpc.requestAirdrop(...).send()`.
            return airdrop({
                commitment: 'confirmed',
                recipientAddress: address,
                lamports: lamports(BigInt(Math.round(amount * LAMPORTS_PER_SOL))),
            });
        },
        onSuccess: () => {
            // TODO: Add back Toast
            // transactionToast(signature)
            console.log('Airdrop sent');
            return Promise.all([
                queryClient.invalidateQueries({
                    queryKey: ['get-balance', { endpoint: cluster.endpoint, address }],
                }),
                queryClient.invalidateQueries({
                    queryKey: ['get-signatures', { endpoint: cluster.endpoint, address }],
                }),
            ]);
        },
    });
}
