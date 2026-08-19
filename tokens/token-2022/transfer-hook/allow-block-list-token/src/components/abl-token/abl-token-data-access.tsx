'use client';

import { useKitTransactionSigner, useSolanaClient } from '@solana/connector/react';
import {
    generateKeyPairSigner,
    getBase58Decoder,
    parseBase64RpcAccount,
    type Address,
    type Base58EncodedBytes,
} from '@solana/kit';
import { fetchMint, getMintToATAInstructionPlanAsync, type Extension } from '@solana-program/token-2022';
import { assertIsSingleInstructionPlan, flattenInstructionPlan } from '@solana/instruction-plans';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
import { findConfigPda } from '@/generated/pdas';
import { ABL_TOKEN_PROGRAM_ADDRESS } from '@/generated/programs';
import { Mode } from '@/generated/types';
import { useCluster } from '../cluster/cluster-data-access';
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

export function useGetToken(mint: Address) {
    const { client } = useSolanaClient();
    const { cluster } = useCluster();

    return useQuery({
        enabled: client !== null,
        queryKey: ['get-token', { endpoint: cluster.endpoint, mint }],
        queryFn: async () => {
            const mintAccount = await fetchMint(client!.rpc, mint);
            const extensions = mintExtensions(mintAccount);

            const metadata = findExtension(extensions, 'TokenMetadata');
            const mode = metadata?.additionalMetadata.get('AB') ?? null;
            const threshold = metadata?.additionalMetadata.get('threshold') ?? null;

            const permanentDelegate = findExtension(extensions, 'PermanentDelegate')?.delegate ?? null;

            const transferHook = findExtension(extensions, 'TransferHook');
            const isTransferHookEnabled = transferHook !== undefined;
            const isTransferHookSet = transferHook?.programId === ABL_TOKEN_PROGRAM_ADDRESS;
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
    const { client } = useSolanaClient();
    const { cluster } = useCluster();
    const transactionToast = useTransactionToast();
    const { signer } = useKitTransactionSigner();
    const sendInstruction = useSendInstruction();
    const queryClient = useQueryClient();

    const getProgramAccount = useQuery({
        enabled: client !== null,
        queryKey: ['get-program-account', { cluster }],
        queryFn: () =>
            client!.rpc
                .getAccountInfo(ABL_TOKEN_PROGRAM_ADDRESS, { encoding: 'jsonParsed', commitment: 'confirmed' })
                .send(),
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

            const ix = await getInitMintInstructionAsync({
                payer: signer,
                mint,
                decimals: args.decimals,
                mintAuthority: args.mintAuthority,
                freezeAuthority: args.freezeAuthority,
                permanentDelegate: args.permanentDelegate,
                transferHookAuthority: args.transferHookAuthority,
                mode: modeEnum,
                threshold: args.threshold,
                name: args.name,
                symbol: args.symbol,
                uri: args.uri,
            });

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
            const ix = await getAttachToMintInstructionAsync({ payer: signer, mint: args.mint });
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
            const ix = getChangeModeInstruction({
                authority: signer,
                mint: args.mint,
                mode: modeEnum,
                threshold: args.threshold,
            });
            return sendInstruction(ix, signer);
        },
        onSuccess: signature => {
            transactionToast(signature);
        },
        onError: () => toast.error('Failed to run program'),
    });

    const initWallet = useMutation({
        mutationKey: ['abl-token', 'init-wallet', { cluster }],
        mutationFn: async (args: { wallet: Address; allowed: boolean }) => {
            if (!signer) throw new Error('Wallet not connected');
            const ix = await getInitWalletInstructionAsync({
                authority: signer,
                wallet: args.wallet,
                allowed: args.allowed,
            });
            return sendInstruction(ix, signer);
        },
        onSuccess: signature => {
            transactionToast(signature);
            return queryClient.invalidateQueries({ queryKey: ['get-ab-wallets', { cluster }] });
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
                        return getRemoveWalletInstructionAsync({ authority: signer, wallet: wallet.wallet });
                    }
                    return getInitWalletInstructionAsync({
                        authority: signer,
                        wallet: wallet.wallet,
                        allowed: wallet.mode === 'allow',
                    });
                }),
            );

            return sendInstruction(instructions, signer);
        },
        onSuccess: signature => {
            transactionToast(signature);
            return queryClient.invalidateQueries({ queryKey: ['get-ab-wallets', { cluster }] });
        },
        onError: () => toast.error('Failed to run program'),
    });

    const removeWallet = useMutation({
        mutationKey: ['abl-token', 'remove-wallet', { cluster }],
        mutationFn: async (args: { wallet: Address }) => {
            if (!signer) throw new Error('Wallet not connected');
            const ix = await getRemoveWalletInstructionAsync({ authority: signer, wallet: args.wallet });
            return sendInstruction(ix, signer);
        },
        onSuccess: signature => {
            transactionToast(signature);
            return queryClient.invalidateQueries({ queryKey: ['get-ab-wallets', { cluster }] });
        },
        onError: () => toast.error('Failed to run program'),
    });

    const initConfig = useMutation({
        mutationKey: ['abl-token', 'init-config', { cluster }],
        mutationFn: async () => {
            if (!signer) throw new Error('Wallet not connected');
            const ix = await getInitConfigInstructionAsync({ payer: signer });
            return sendInstruction(ix, signer);
        },
    });

    const getConfig = useQuery({
        enabled: client !== null,
        queryKey: ['get-config', { cluster }],
        queryFn: async () => {
            const [configPda] = await findConfigPda();
            return (await fetchConfig(client!.rpc, configPda)).data;
        },
    });

    const getAbWallets = useQuery({
        enabled: client !== null,
        queryKey: ['get-ab-wallets', { cluster }],
        queryFn: async () => {
            const discriminatorBase58 = getBase58Decoder().decode(A_B_WALLET_DISCRIMINATOR) as Base58EncodedBytes;
            const accounts = await client!.rpc
                .getProgramAccounts(ABL_TOKEN_PROGRAM_ADDRESS, {
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
            if (!signer || !client) throw new Error('Wallet not connected');
            const mintAccount = await fetchMint(client.rpc, args.mint);

            // Plans the idempotent-create-ATA and mint-to instructions together. Minting is not
            // a transfer, so tx_hook never runs and no extra-account resolution is required.
            const plan = await getMintToATAInstructionPlanAsync({
                payer: signer,
                owner: args.recipient,
                mint: args.mint,
                mintAuthority: signer,
                amount: args.amount,
                decimals: mintAccount.data.decimals,
            });
            const instructions = flattenInstructionPlan(plan).map(single => {
                assertIsSingleInstructionPlan(single);
                return single.instruction;
            });

            return sendInstruction(instructions, signer);
        },
        onSuccess: signature => {
            transactionToast(signature);
        },
        onError: () => toast.error('Failed to run program'),
    });

    return {
        programId: ABL_TOKEN_PROGRAM_ADDRESS,
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
