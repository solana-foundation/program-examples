'use client';

import { useKitTransactionSigner } from '@solana/connector/react';
import {
    address as toAddress,
    generateKeyPairSigner,
    getBase58Decoder,
    parseBase64RpcAccount,
    type Address,
    type Base58EncodedBytes,
} from '@solana/kit';
import {
    fetchMint,
    findAssociatedTokenPda,
    getCreateAssociatedTokenIdempotentInstructionAsync,
    getMintToCheckedInstruction,
    TOKEN_2022_PROGRAM_ADDRESS,
    type Extension,
} from '@solana-program/token-2022';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { toast } from 'sonner';
import { useSendInstruction } from '@/hooks/use-send-instruction';
import { A_B_WALLET_DISCRIMINATOR, decodeABWallet, fetchConfig } from '@/generated/accounts';
import {
    getAttachToMintInstructionAsync,
    getChangeModeInstruction,
    getInitConfigInstructionAsync,
    getInitMintInstructionAsync,
    getInitWalletInstructionAsync,
    getRemoveWalletInstructionAsync,
} from '@/generated/instructions';
import { findAbWalletPda, findConfigPda } from '@/generated/pdas';
import { ABL_TOKEN_PROGRAM_ADDRESS } from '@/generated/programs';
import { Mode } from '@/generated/types';
import { ClusterNetwork, useCluster, useClusterRpc, type SolanaCluster } from '../cluster/cluster-data-access';
import { useTransactionToast } from '../use-transaction-toast';

function findExtension<TKind extends Extension['__kind']>(
    extensions: Extension[] | undefined,
    kind: TKind,
): Extract<Extension, { __kind: TKind }> | undefined {
    return extensions?.find((ext): ext is Extract<Extension, { __kind: TKind }> => ext.__kind === kind);
}

function mintExtensions(mint: Awaited<ReturnType<typeof fetchMint>>): Extension[] {
    return mint.data.extensions.__option === 'Some' ? mint.data.extensions.value : [];
}

// The program deployed to devnet/testnet was built from a keypair that no longer matches
// this repo's `declare_id!` — the Anchor.toml keypair is intentionally left mismatched
// (see AGENTS.md), so devnet/testnet keep pointing at the address they were actually
// deployed under instead of the IDL's local `address` field.
function programIdForCluster(cluster: SolanaCluster): Address {
    if (cluster.network === ClusterNetwork.Devnet || cluster.network === ClusterNetwork.Testnet) {
        return toAddress('6z68wfurCMYkZG51s1Et9BJEd9nJGUusjHXNt4dGbNNF');
    }
    return ABL_TOKEN_PROGRAM_ADDRESS;
}

export function useHasTransferHookEnabled(mint: Address) {
    const { rpc } = useClusterRpc();
    const { cluster } = useCluster();
    const programId = useMemo(() => programIdForCluster(cluster), [cluster]);

    return useQuery({
        queryKey: ['has-transfer-hook', { cluster, mint }],
        queryFn: async () => {
            const mintAccount = await fetchMint(rpc, mint);
            const transferHook = findExtension(mintExtensions(mintAccount), 'TransferHook');
            return transferHook !== undefined && transferHook.programId === programId;
        },
    });
}

export function useGetToken(mint: Address) {
    const { rpc } = useClusterRpc();
    const { cluster } = useCluster();
    const programId = useMemo(() => programIdForCluster(cluster), [cluster]);

    return useQuery({
        queryKey: ['get-token', { endpoint: cluster.endpoint, mint }],
        queryFn: async () => {
            const mintAccount = await fetchMint(rpc, mint);
            const extensions = mintExtensions(mintAccount);

            const metadata = findExtension(extensions, 'TokenMetadata');
            const mode = metadata?.additionalMetadata.get('AB') ?? null;
            const threshold = metadata?.additionalMetadata.get('threshold') ?? null;

            const permanentDelegate = findExtension(extensions, 'PermanentDelegate')?.delegate ?? null;

            const transferHook = findExtension(extensions, 'TransferHook');
            const isTransferHookEnabled = transferHook !== undefined;
            const isTransferHookSet = transferHook?.programId === programId;
            const transferHookProgramId = transferHook?.programId ?? null;

            return {
                name: metadata?.name,
                symbol: metadata?.symbol,
                uri: metadata?.uri,
                decimals: mintAccount.data.decimals,
                supply: mintAccount.data.supply,
                mintAuthority:
                    mintAccount.data.mintAuthority.__option === 'Some' ? mintAccount.data.mintAuthority.value : null,
                freezeAuthority:
                    mintAccount.data.freezeAuthority.__option === 'Some'
                        ? mintAccount.data.freezeAuthority.value
                        : null,
                permanentDelegate,
                isTransferHookEnabled,
                isTransferHookSet,
                transferHookProgramId,
                mode,
                threshold,
            };
        },
    });
}

export function useAblTokenProgram() {
    const { rpc } = useClusterRpc();
    const { cluster } = useCluster();
    const transactionToast = useTransactionToast();
    const { signer } = useKitTransactionSigner();
    const sendInstruction = useSendInstruction();
    const programId = useMemo(() => programIdForCluster(cluster), [cluster]);

    const getProgramAccount = useQuery({
        queryKey: ['get-program-account', { cluster }],
        queryFn: () => rpc.getAccountInfo(programId, { encoding: 'jsonParsed', commitment: 'confirmed' }).send(),
    });

    const initToken = useMutation({
        mutationKey: ['abl-token', 'init-token', { cluster }],
        mutationFn: async (args: {
            mintAuthority: Address;
            freezeAuthority: Address;
            permanentDelegate: Address;
            transferHookAuthority: Address;
            mode: 'allow' | 'block' | 'threshold';
            threshold: bigint;
            name: string;
            symbol: string;
            uri: string;
            decimals: number;
        }) => {
            if (!signer) throw new Error('Wallet not connected');
            const modeEnum = args.mode === 'allow' ? Mode.Allow : args.mode === 'block' ? Mode.Block : Mode.Mixed;
            const mint = await generateKeyPairSigner();

            const ix = await getInitMintInstructionAsync(
                {
                    payer: signer,
                    mint,
                    decimals: args.decimals,
                    mintAuthority: args.mintAuthority,
                    freezeAuthority: args.freezeAuthority,
                    permanentDelegate: args.permanentDelegate,
                    transferHookAuthority: args.mintAuthority,
                    mode: modeEnum,
                    threshold: args.threshold,
                    name: args.name,
                    symbol: args.symbol,
                    uri: args.uri,
                },
                { programAddress: programId },
            );

            const signature = await sendInstruction(ix, signer);
            return { signature, mintAddress: mint.address };
        },
        onSuccess: ({ signature, mintAddress }) => {
            transactionToast(signature);
            window.location.href = `/manage-token/${mintAddress}`;
        },
        onError: () => toast.error('Failed to initialize token'),
    });

    const attachToExistingToken = useMutation({
        mutationKey: ['abl-token', 'attach-to-existing-token', { cluster }],
        mutationFn: async (args: { mint: Address }) => {
            if (!signer) throw new Error('Wallet not connected');
            const ix = await getAttachToMintInstructionAsync(
                { payer: signer, mint: args.mint },
                { programAddress: programId },
            );
            return sendInstruction(ix, signer);
        },
        onSuccess: signature => {
            transactionToast(signature);
        },
        onError: () => toast.error('Failed to initialize token'),
    });

    const changeMode = useMutation({
        mutationKey: ['abl-token', 'change-mode', { cluster }],
        mutationFn: async (args: { mode: string; threshold: bigint; mint: Address }) => {
            if (!signer) throw new Error('Wallet not connected');
            const modeEnum = args.mode === 'Allow' ? Mode.Allow : args.mode === 'Block' ? Mode.Block : Mode.Mixed;
            const ix = getChangeModeInstruction(
                { authority: signer, mint: args.mint, mode: modeEnum, threshold: args.threshold },
                { programAddress: programId },
            );
            return sendInstruction(ix, signer);
        },
        onSuccess: signature => {
            transactionToast(signature);
        },
        onError: () => toast.error('Failed to run program'),
    });

    const initWallet = useMutation({
        mutationKey: ['abl-token', 'change-mode', { cluster }],
        mutationFn: async (args: { wallet: Address; allowed: boolean }) => {
            if (!signer) throw new Error('Wallet not connected');
            const ix = await getInitWalletInstructionAsync(
                { authority: signer, wallet: args.wallet, allowed: args.allowed },
                { programAddress: programId },
            );
            return sendInstruction(ix, signer);
        },
        onSuccess: signature => {
            transactionToast(signature);
        },
        onError: () => toast.error('Failed to run program'),
    });

    const processBatchWallets = useMutation({
        mutationKey: ['abl-token', 'process-batch-wallets', { cluster }],
        mutationFn: async (args: { wallets: { wallet: Address; mode: 'allow' | 'block' | 'remove' }[] }) => {
            if (!signer) throw new Error('Wallet not connected');
            const instructions = await Promise.all(
                args.wallets.map(async wallet => {
                    if (wallet.mode === 'remove') {
                        const [abWalletPda] = await findAbWalletPda(
                            { wallet: wallet.wallet },
                            { programAddress: programId },
                        );
                        return getRemoveWalletInstructionAsync(
                            { authority: signer, abWallet: abWalletPda },
                            { programAddress: programId },
                        );
                    }
                    return getInitWalletInstructionAsync(
                        { authority: signer, wallet: wallet.wallet, allowed: wallet.mode === 'allow' },
                        { programAddress: programId },
                    );
                }),
            );

            return sendInstruction(instructions, signer);
        },
        onSuccess: signature => {
            transactionToast(signature);
        },
        onError: () => toast.error('Failed to run program'),
    });

    const removeWallet = useMutation({
        mutationKey: ['abl-token', 'change-mode', { cluster }],
        mutationFn: async (args: { wallet: Address }) => {
            if (!signer) throw new Error('Wallet not connected');
            const [abWalletPda] = await findAbWalletPda({ wallet: args.wallet }, { programAddress: programId });
            const ix = await getRemoveWalletInstructionAsync(
                { authority: signer, abWallet: abWalletPda },
                { programAddress: programId },
            );
            return sendInstruction(ix, signer);
        },
        onSuccess: signature => {
            transactionToast(signature);
        },
        onError: () => toast.error('Failed to run program'),
    });

    const initConfig = useMutation({
        mutationKey: ['abl-token', 'init-config', { cluster }],
        mutationFn: async () => {
            if (!signer) throw new Error('Wallet not connected');
            const ix = await getInitConfigInstructionAsync({ payer: signer }, { programAddress: programId });
            return sendInstruction(ix, signer);
        },
    });

    const getConfig = useQuery({
        queryKey: ['get-config', { cluster }],
        queryFn: async () => {
            const [configPda] = await findConfigPda({ programAddress: programId });
            return (await fetchConfig(rpc, configPda)).data;
        },
    });

    const getAbWallets = useQuery({
        queryKey: ['get-ab-wallets', { cluster }],
        queryFn: async () => {
            const discriminatorBase58 = getBase58Decoder().decode(A_B_WALLET_DISCRIMINATOR) as Base58EncodedBytes;
            const accounts = await rpc
                .getProgramAccounts(programId, {
                    encoding: 'base64',
                    filters: [{ memcmp: { offset: BigInt(0), bytes: discriminatorBase58, encoding: 'base58' } }],
                })
                .send();

            return accounts.map(({ pubkey, account }) => {
                const decoded = decodeABWallet(parseBase64RpcAccount(pubkey, account));
                return { publicKey: pubkey, account: { wallet: decoded.data.wallet, allowed: decoded.data.allowed } };
            });
        },
    });

    const mintTo = useMutation({
        mutationKey: ['abl-token', 'mint-to', { cluster }],
        mutationFn: async (args: { mint: Address; amount: bigint; recipient: Address }) => {
            if (!signer) throw new Error('Wallet not connected');
            const mintAccount = await fetchMint(rpc, args.mint);
            const [ata] = await findAssociatedTokenPda({
                owner: args.recipient,
                mint: args.mint,
                tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
            });

            const createAtaIx = await getCreateAssociatedTokenIdempotentInstructionAsync({
                payer: signer,
                owner: args.recipient,
                mint: args.mint,
                tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
            });
            const mintToIx = getMintToCheckedInstruction(
                {
                    mint: args.mint,
                    token: ata,
                    mintAuthority: signer,
                    amount: args.amount,
                    decimals: mintAccount.data.decimals,
                },
                { programAddress: TOKEN_2022_PROGRAM_ADDRESS },
            );

            return sendInstruction([createAtaIx, mintToIx], signer);
        },
        onSuccess: signature => {
            transactionToast(signature);
        },
        onError: () => toast.error('Failed to run program'),
    });

    return {
        programId,
        getProgramAccount,
        initToken,
        changeMode,
        initWallet,
        removeWallet,
        initConfig,
        getConfig,
        getAbWallets,
        processBatchWallets,
        mintTo,
        attachToExistingToken,
    };
}
