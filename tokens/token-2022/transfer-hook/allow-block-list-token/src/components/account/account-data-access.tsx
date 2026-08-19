'use client';

import { LAMPORTS_PER_SOL } from '@solana/connector';
import { useKitTransactionSigner, useSolanaClient, useWallet } from '@solana/connector/react';
import { airdropFactory, fetchEncodedAccount, lamports, type Address } from '@solana/kit';
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
import { findExtraMetasAccountPda } from '@/generated/pdas';
import { useCluster } from '../cluster/cluster-data-access';
import { useTransactionErrorToast, useTransactionToast } from '../use-transaction-toast';

// These read an arbitrary address, so they can't use connector's `useBalance`/`useTokens`/
// `useTransactions`, which are scoped to the connected wallet and take no address.
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

            const extensions = mintAccount.data.extensions.__option === 'Some' ? mintAccount.data.extensions.value : [];
            const transferHook = extensions.find(extension => extension.__kind === 'TransferHook');
            if (!transferHook) throw new Error('This mint has no transfer hook, so it is not an allow/block token');

            const [extraMetasPda] = await findExtraMetasAccountPda(
                { mint },
                { programAddress: transferHook.programId },
            );
            const extraMetasAccount = await fetchEncodedAccount(client.rpc, extraMetasPda);
            if (!extraMetasAccount.exists) {
                throw new Error(`Transfer hook validation account ${extraMetasPda} not found — attach the mint first`);
            }

            // The hook derives the receiver's ab_wallet PDA from the owner field stored in the
            // destination token account, so that account has to exist on chain before the
            // transfer instruction can be assembled. Creating it in the same transaction is too
            // late: resolution happens here, client-side, against current chain state.
            const destinationTokenAccount = await fetchEncodedAccount(client.rpc, ataDestination);
            if (!destinationTokenAccount.exists) {
                const createAtaIx = await getCreateAssociatedTokenIdempotentInstructionAsync({
                    payer: signer,
                    owner: destination,
                    mint,
                    tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
                });
                await sendInstruction(createAtaIx, signer);
            }

            // Reads the mint's on-chain extra-account-metas list to resolve the accounts the
            // hook's Execute CPI needs — both the sender's and the receiver's ab_wallet PDAs,
            // the hook program, and its validation account.
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

            return sendInstruction(transferIx, signer);
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
    const transactionToast = useTransactionToast();
    const transactionErrorToast = useTransactionErrorToast();

    return useMutation({
        mutationKey: ['transfer-sol', { endpoint: cluster.endpoint, address }],
        mutationFn: async (input: { destination: Address; amount: number }) => {
            if (!signer) throw new Error('Wallet not connected');
            // Only the connected wallet can sign, so this hook applies solely to the page
            // showing that wallet's own account.
            if (signer.address !== address) {
                throw new Error('Connected wallet does not match the account being viewed');
            }
            const ix = getTransferSolInstruction({
                source: signer,
                destination: input.destination,
                amount: lamports(BigInt(Math.round(input.amount * LAMPORTS_PER_SOL))),
            });
            return sendInstruction(ix, signer);
        },
        onSuccess: signature => {
            transactionToast(signature);
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
            transactionErrorToast(error);
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
            // `airdropFactory` requests the airdrop and waits for confirmation.
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
