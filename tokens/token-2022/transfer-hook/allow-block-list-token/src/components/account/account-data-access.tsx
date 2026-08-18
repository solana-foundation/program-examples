'use client';

import { useKitTransactionSigner, useWallet } from '@solana/connector/react';
import { AccountRole, lamports, type Address } from '@solana/kit';
import {
    fetchMint,
    findAssociatedTokenPda,
    getCreateAssociatedTokenIdempotentInstructionAsync,
    getTransferCheckedInstruction,
    TOKEN_2022_PROGRAM_ADDRESS,
    TOKEN_PROGRAM_ADDRESS,
    type Extension,
} from '@solana-program/token-2022';
import { getTransferSolInstruction } from '@solana-program/system';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSendInstruction } from '@/hooks/use-send-instruction';
import { findAbWalletPda, findExtraMetasAccountPda } from '@/generated/pdas';
import { useCluster, useClusterRpc } from '../cluster/cluster-data-access';
import { useTransactionErrorToast, useTransactionToast } from '../use-transaction-toast';

const LAMPORTS_PER_SOL = 1_000_000_000;

function findExtension<TKind extends Extension['__kind']>(
    extensions: Extension[] | undefined,
    kind: TKind,
): Extract<Extension, { __kind: TKind }> | undefined {
    return extensions?.find((ext): ext is Extract<Extension, { __kind: TKind }> => ext.__kind === kind);
}

export function useGetBalance({ address }: { address: Address }) {
    const { rpc } = useClusterRpc();
    const { cluster } = useCluster();

    return useQuery({
        queryKey: ['get-balance', { endpoint: cluster.endpoint, address }],
        queryFn: async () => Number((await rpc.getBalance(address).send()).value),
    });
}

export function useGetSignatures({ address }: { address: Address }) {
    const { rpc } = useClusterRpc();
    const { cluster } = useCluster();

    return useQuery({
        queryKey: ['get-signatures', { endpoint: cluster.endpoint, address }],
        queryFn: () => rpc.getSignaturesForAddress(address).send(),
    });
}

export function useSendTokens() {
    const { rpc } = useClusterRpc();
    const { account } = useWallet();
    const { signer } = useKitTransactionSigner();
    const sendInstruction = useSendInstruction();
    const transactionToast = useTransactionToast();
    const transactionErrorToast = useTransactionErrorToast();

    return useMutation({
        mutationFn: async (args: { mint: Address; destination: Address; amount: number }) => {
            if (!signer || !account) throw new Error('No public key found');
            const { mint, destination, amount } = args;

            const mintAccount = await fetchMint(rpc, mint);
            const decimals = mintAccount.data.decimals;
            const extensions = mintAccount.data.extensions.__option === 'Some' ? mintAccount.data.extensions.value : [];
            const transferHook = findExtension(extensions, 'TransferHook');
            if (!transferHook) throw new Error('bad token');

            const [ataDestination] = await findAssociatedTokenPda({
                owner: destination,
                mint,
                tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
            });
            const [ataSource] = await findAssociatedTokenPda({
                owner: account,
                mint,
                tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
            });

            const createAtaIx = await getCreateAssociatedTokenIdempotentInstructionAsync({
                payer: signer,
                owner: destination,
                mint,
                tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
            });

            const transferIx = getTransferCheckedInstruction(
                {
                    source: ataSource,
                    mint,
                    destination: ataDestination,
                    authority: signer,
                    amount: BigInt(amount),
                    decimals,
                },
                { programAddress: TOKEN_2022_PROGRAM_ADDRESS },
            );

            // The hook checks both the sender's and the receiver's allow/block status, so the
            // client must resolve and append both ab_wallet PDAs, in the same order the
            // program's get_extra_account_metas() declares them: source, then destination.
            // After that comes the transfer-hook program itself, then the extra-account-meta-
            // list PDA — all readonly, non-signer.
            const [sourceAbWalletPda] = await findAbWalletPda(
                { wallet: account },
                { programAddress: transferHook.programId },
            );
            const [destinationAbWalletPda] = await findAbWalletPda(
                { wallet: destination },
                { programAddress: transferHook.programId },
            );
            const [extraMetasPda] = await findExtraMetasAccountPda(
                { mint },
                { programAddress: transferHook.programId },
            );

            const validateStateAccount = await rpc.getAccountInfo(extraMetasPda, { commitment: 'confirmed' }).send();
            if (!validateStateAccount.value) throw new Error('validate-state-account not found');

            const transferIxWithHookAccounts = {
                ...transferIx,
                accounts: [
                    ...transferIx.accounts,
                    { address: sourceAbWalletPda, role: AccountRole.READONLY },
                    { address: destinationAbWalletPda, role: AccountRole.READONLY },
                    { address: transferHook.programId, role: AccountRole.READONLY },
                    { address: extraMetasPda, role: AccountRole.READONLY },
                ],
            };

            return sendInstruction([createAtaIx, transferIxWithHookAccounts], signer);
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
    const { rpc } = useClusterRpc();
    const { cluster } = useCluster();

    return useQuery({
        queryKey: ['get-token-accounts', { endpoint: cluster.endpoint, address }],
        queryFn: async () => {
            const [tokenAccounts, token2022Accounts] = await Promise.all([
                rpc
                    .getTokenAccountsByOwner(address, { programId: TOKEN_PROGRAM_ADDRESS }, { encoding: 'jsonParsed' })
                    .send(),
                rpc
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
    const { rpc } = useClusterRpc();
    const { cluster } = useCluster();
    const client = useQueryClient();

    return useMutation({
        mutationKey: ['airdrop', { endpoint: cluster.endpoint, address }],
        mutationFn: async (amount: number = 1) => {
            const signature = await rpc
                .requestAirdrop(address, lamports(BigInt(Math.round(amount * LAMPORTS_PER_SOL))), {
                    commitment: 'confirmed',
                })
                .send();
            return signature;
        },
        onSuccess: () => {
            // TODO: Add back Toast
            // transactionToast(signature)
            console.log('Airdrop sent');
            return Promise.all([
                client.invalidateQueries({
                    queryKey: ['get-balance', { endpoint: cluster.endpoint, address }],
                }),
                client.invalidateQueries({
                    queryKey: ['get-signatures', { endpoint: cluster.endpoint, address }],
                }),
            ]);
        },
    });
}
