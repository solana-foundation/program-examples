import 'server-only';

import {
    buildCommitProofContext,
    CC_VRF_PROGRAM_ID,
    deriveProofCommitWithBetaAddress,
    fetchAuthority,
    forceLightV2,
    getProgram,
    memoHash,
} from '@collectorcrypt/vrf-client';
import * as anchor from '@coral-xyz/anchor';
import { createRpc } from '@lightprotocol/stateless.js';
import {
    GACHA_PROGRAM_ADDRESS,
    gachaProgram,
    getPoolDecoder,
    getPullDecoder,
    getSettlePullDataEncoder,
    provePull,
    pullAlpha,
    RARITY_LABELS,
} from '@solana/gacha';
import { type Address, createClient, createKeyPairSignerFromBytes } from '@solana/kit';
import { solanaRpc } from '@solana/kit-plugin-rpc';
import { signer as signerPlugin } from '@solana/kit-plugin-signer';
import {
    ComputeBudgetProgram,
    Connection,
    PublicKey,
    sendAndConfirmTransaction,
    SystemProgram,
    Transaction,
    TransactionInstruction,
} from '@solana/web3.js';
import { findAssociatedTokenPda, TOKEN_2022_PROGRAM_ADDRESS } from '@solana-program/token-2022';

import type { PullServerConfig } from './pull-config';
import { PullProcessError } from './pull-error';
import type { ValidatedBuy } from './validate-buy';

const CC_VRF_ID = new PublicKey('ccvrfu3fSpbnPLiUqdWAt85Zn9nq96ekwGTbHqGtdgQ');
const LIGHT_SYSTEM_PROGRAM_ID = new PublicKey('SySTEM1eSU2p4BGQfQpimFEWWSC1XDFeun3Nqzz3rT7');
const CC_VRF_CPI_AUTHORITY = new PublicKey('JEwC9hjj9yfWCQZQsMvy8zG92CcThefPxEp5T63UCFD');
const REGISTERED_PROGRAM_PDA = new PublicKey('35hkDgaAKwMCaxRz2ocSZ6NaUrtKkyNqU6c4RV3tYJRh');
const ACCOUNT_COMPRESSION_AUTHORITY = new PublicKey('HwXnGK3tPkkVY6P439H2p68AxpeuWXd5PcrAxFpbmfbA');
const ACCOUNT_COMPRESSION_PROGRAM_ID = new PublicKey('compr6CUsB5m2jS4Y3831ztGSTnDpnKJTKS95d64XVq');
const ADDRESS_TREE_V2 = new PublicKey('amt2kaJA14v3urZbZvnc5v2np8jqvc4Z8zDep5wbtzx');
const PULL_STATUS_PENDING = 0;
const PULL_STATUS_SETTLED = 1;
const PULL_STATUS_CLAIMED = 2;

/** Final response returned after the pull prize exists in the buyer's ATA. */
export interface OrchestratedPull {
    readonly buySignature: string;
    readonly buyer: Address;
    readonly buyerAta: Address;
    readonly claimSignature: string | null;
    readonly mint: Address;
    readonly pull: Address;
    readonly rarity: string;
    readonly settleSignature: string | null;
    readonly status: 'claimed';
    readonly tier: number;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
    return a.length === b.length && a.every((value, index) => value === b[index]);
}

async function confirmedOrSubmit(connection: Connection, buy: ValidatedBuy): Promise<void> {
    const existing = (await connection.getSignatureStatuses([buy.signature], { searchTransactionHistory: true }))
        .value[0];
    if (existing?.err) {
        throw new PullProcessError('submit', 'buy_failed', 'The signed buy transaction failed on-chain.', false, {
            buySignature: buy.signature,
        });
    }
    if (existing?.confirmationStatus === 'confirmed' || existing?.confirmationStatus === 'finalized') return;

    try {
        await connection.sendRawTransaction(buy.rawTransaction, {
            preflightCommitment: 'confirmed',
            skipPreflight: false,
        });
        await connection.confirmTransaction(buy.signature, 'confirmed');
    } catch {
        const status = (await connection.getSignatureStatuses([buy.signature], { searchTransactionHistory: true }))
            .value[0];
        if (
            status &&
            !status.err &&
            (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized')
        ) {
            return;
        }
        throw new PullProcessError(
            'submit',
            'buy_not_confirmed',
            'The buy transaction was not confirmed. Its blockhash may have expired.',
            false,
            { buySignature: buy.signature },
        );
    }
}

function buildLightContext(
    proof: { a: number[]; b: number[]; c: number[] },
    authorityAddress: PublicKey,
    authorityCreatedSlot: bigint,
    authorityMeta: { leafIndex: number; proveByIndex: boolean; rootIndex: number },
    addressTreeRootIndex: number,
) {
    const validityProof = [...proof.a, ...proof.b, ...proof.c];
    if (validityProof.length !== 128) {
        throw new PullProcessError('settle', 'invalid_light_proof', 'The Light validity proof is invalid.', true);
    }
    return {
        addressTreeRootIndex,
        authorityAddress: Array.from(authorityAddress.toBytes()),
        authorityCreatedSlot,
        authorityLeafIndex: authorityMeta.leafIndex,
        authorityProveByIndex: authorityMeta.proveByIndex ? 1 : 0,
        authorityRootIndex: authorityMeta.rootIndex,
        validityProof,
    };
}

function settleInstruction(
    config: PullServerConfig,
    pull: PublicKey,
    eventAuthority: PublicKey,
    trees: [PublicKey, PublicKey, PublicKey, PublicKey],
    data: Buffer,
): TransactionInstruction {
    return new TransactionInstruction({
        data,
        keys: [
            { isSigner: true, isWritable: true, pubkey: config.operator.publicKey },
            { isSigner: false, isWritable: true, pubkey: config.pool },
            { isSigner: false, isWritable: true, pubkey: pull },
            { isSigner: false, isWritable: false, pubkey: CC_VRF_ID },
            { isSigner: false, isWritable: false, pubkey: LIGHT_SYSTEM_PROGRAM_ID },
            { isSigner: false, isWritable: false, pubkey: CC_VRF_CPI_AUTHORITY },
            { isSigner: false, isWritable: false, pubkey: REGISTERED_PROGRAM_PDA },
            { isSigner: false, isWritable: false, pubkey: ACCOUNT_COMPRESSION_AUTHORITY },
            { isSigner: false, isWritable: false, pubkey: ACCOUNT_COMPRESSION_PROGRAM_ID },
            { isSigner: false, isWritable: false, pubkey: SystemProgram.programId },
            { isSigner: false, isWritable: true, pubkey: trees[0] },
            { isSigner: false, isWritable: true, pubkey: trees[1] },
            { isSigner: false, isWritable: true, pubkey: trees[2] },
            { isSigner: false, isWritable: true, pubkey: trees[3] },
            { isSigner: false, isWritable: false, pubkey: eventAuthority },
            { isSigner: false, isWritable: false, pubkey: new PublicKey(GACHA_PROGRAM_ADDRESS) },
        ],
        programId: new PublicKey(GACHA_PROGRAM_ADDRESS),
    });
}

async function settlePendingPull(
    connection: Connection,
    config: PullServerConfig,
    pullAddress: Address,
    pullData: ReturnType<ReturnType<typeof getPullDecoder>['decode']>,
): Promise<string> {
    const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(config.operator), {
        commitment: 'confirmed',
    });
    const program = getProgram(provider);
    const rpc = createRpc(config.rpcUrl, config.rpcUrl, config.rpcUrl);
    forceLightV2();

    const poolInfo = await connection.getAccountInfo(config.pool, 'confirmed');
    if (!poolInfo)
        throw new PullProcessError('settle', 'pool_not_found', 'The configured pool no longer exists.', false);
    const pool = getPoolDecoder().decode(new Uint8Array(poolInfo.data));
    if (pool.operator !== config.operator.publicKey.toBase58()) {
        throw new PullProcessError(
            'settle',
            'operator_mismatch',
            'The configured key is not this pool’s operator.',
            false,
        );
    }

    const pullKey = new PublicKey(pullAddress);
    const alpha = pullAlpha(pullAddress, Uint8Array.from(pullData.clientSeed));
    if (!bytesEqual(alpha, Uint8Array.from(pullData.alpha))) {
        throw new PullProcessError('settle', 'alpha_mismatch', 'The pull alpha does not match its client seed.', false);
    }
    const { beta, proof } = provePull(config.operator.secretKey.slice(0, 32), alpha);
    const memo = pullKey.toBytes();
    const authority = await fetchAuthority(
        program,
        rpc,
        config.operator.publicKey,
        Uint8Array.from(pool.authorityLabel),
    );
    if (!authority || !authority.decoded.frozen) {
        throw new PullProcessError(
            'settle',
            'operator_not_frozen',
            'The operator’s cc-vrf authority is unavailable.',
            false,
        );
    }

    const commitAddress = deriveProofCommitWithBetaAddress(
        authority.authorityAddress,
        memoHash(memo),
        CC_VRF_PROGRAM_ID,
    );
    const context = await buildCommitProofContext(rpc, CC_VRF_PROGRAM_ID, authority.account, commitAddress);
    const validityProof = context.proof[0];
    if (!validityProof)
        throw new PullProcessError('settle', 'proof_unavailable', 'A Light proof was not returned.', true);

    const metas = context.remainingAccountMetas;
    const merkleIndex = context.authorityReadOnlyMeta.treeInfo.merkleTreePubkeyIndex;
    const queueIndex = context.authorityReadOnlyMeta.treeInfo.queuePubkeyIndex;
    const addressIndex = context.packedAddressTreeInfo.addressMerkleTreePubkeyIndex;
    const outputIndex = context.outputStateTreeIndex;
    const treeBase = metas.length - (Math.max(merkleIndex, queueIndex, addressIndex, outputIndex) + 1);
    const authorityTree = metas[treeBase + merkleIndex]?.pubkey;
    const authorityQueue = metas[treeBase + queueIndex]?.pubkey;
    const addressTree = metas[treeBase + addressIndex]?.pubkey;
    const outputQueue = metas[treeBase + outputIndex]?.pubkey;
    if (!authorityTree || !authorityQueue || !addressTree || !outputQueue || !addressTree.equals(ADDRESS_TREE_V2)) {
        throw new PullProcessError('settle', 'invalid_light_accounts', 'The Light proof accounts are invalid.', true);
    }

    const light = buildLightContext(
        validityProof,
        authority.authorityAddress,
        BigInt(String(authority.decoded.createdSlot)),
        context.authorityReadOnlyMeta.treeInfo,
        context.packedAddressTreeInfo.rootIndex,
    );
    const data = Buffer.concat([
        Buffer.from([2]),
        Buffer.from(getSettlePullDataEncoder().encode({ beta: Array.from(beta), light, proof: Array.from(proof) })),
    ]);
    const [eventAuthority] = configEventAuthority();
    const candidates = outputQueue.equals(authorityQueue) ? [outputQueue] : [outputQueue, authorityQueue];
    for (const candidate of candidates) {
        try {
            return await sendAndConfirmTransaction(
                connection,
                new Transaction().add(
                    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 }),
                    ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }),
                    settleInstruction(
                        config,
                        pullKey,
                        eventAuthority,
                        [authorityTree, authorityQueue, addressTree, candidate],
                        data,
                    ),
                ),
                [config.operator],
                { commitment: 'confirmed' },
            );
        } catch {
            // Some Light contexts require the authority queue as the output queue.
        }
    }
    throw new PullProcessError(
        'settle',
        'settle_failed',
        'The reveal transaction failed. Retry to resume from the pull’s on-chain state.',
        true,
    );
}

function configEventAuthority(): [PublicKey] {
    const [eventAuthority] = PublicKey.findProgramAddressSync(
        [Buffer.from('event_authority')],
        new PublicKey(GACHA_PROGRAM_ADDRESS),
    );
    return [eventAuthority];
}

async function claimSettledPull(
    config: PullServerConfig,
    pullAddress: Address,
    buyer: Address,
): Promise<{ buyerAta: Address; mint: Address; signature: string }> {
    const operatorSigner = await createKeyPairSignerFromBytes(config.operator.secretKey);
    const client = createClient()
        .use(signerPlugin(operatorSigner))
        .use(solanaRpc({ rpcUrl: config.rpcUrl }))
        .use(gachaProgram());
    const [mint] = await client.gacha.pdas.prizeMint({ pull: pullAddress });
    const [buyerAta] = await findAssociatedTokenPda({ mint, owner: buyer, tokenProgram: TOKEN_2022_PROGRAM_ADDRESS });
    try {
        const { context } = await client.gacha.instructions
            .claimPrize({ buyer, buyerAta, mint, payer: operatorSigner, pool: config.poolAddress, pull: pullAddress })
            .sendTransaction();
        return { buyerAta, mint, signature: context.signature };
    } catch {
        throw new PullProcessError(
            'claim',
            'claim_failed',
            'The prize mint transaction failed. Retry to resume from the settled pull.',
            true,
        );
    }
}

/** Submits a signed buy and resumes settle/claim until its NFT exists. */
export async function orchestratePull(
    connection: Connection,
    config: PullServerConfig,
    buy: ValidatedBuy,
): Promise<OrchestratedPull> {
    await confirmedOrSubmit(connection, buy);

    const pullKey = new PublicKey(buy.pull);
    const pullInfo = await connection.getAccountInfo(pullKey, 'confirmed');
    if (!pullInfo) {
        throw new PullProcessError(
            'submit',
            'pull_not_found',
            'The buy confirmed but its pull account was not found.',
            true,
            {
                buySignature: buy.signature,
            },
        );
    }
    let pull = getPullDecoder().decode(new Uint8Array(pullInfo.data));
    if (pull.buyer !== buy.buyer || pull.pool !== config.poolAddress) {
        throw new PullProcessError(
            'validation',
            'pull_mismatch',
            'The created pull does not match this request.',
            false,
            {
                buySignature: buy.signature,
            },
        );
    }

    let settleSignature: string | null = null;
    if (pull.status === PULL_STATUS_PENDING) {
        try {
            settleSignature = await settlePendingPull(connection, config, buy.pull, pull);
        } catch (cause) {
            const concurrentInfo = await connection.getAccountInfo(pullKey, 'confirmed');
            const concurrentPull = concurrentInfo ? getPullDecoder().decode(new Uint8Array(concurrentInfo.data)) : null;
            if (concurrentPull && concurrentPull.status !== PULL_STATUS_PENDING) {
                pull = concurrentPull;
            } else if (cause instanceof PullProcessError) {
                throw new PullProcessError(cause.stage, cause.code, cause.message, cause.retryable, {
                    ...cause.signatures,
                    buySignature: buy.signature,
                });
            } else {
                throw cause;
            }
        }
        const settledInfo = await connection.getAccountInfo(pullKey, 'confirmed');
        if (!settledInfo) throw new PullProcessError('settle', 'pull_not_found', 'The settled pull disappeared.', true);
        pull = getPullDecoder().decode(new Uint8Array(settledInfo.data));
    }
    if (pull.status !== PULL_STATUS_SETTLED && pull.status !== PULL_STATUS_CLAIMED) {
        throw new PullProcessError('settle', 'pull_not_settled', 'The pull did not reach the settled state.', true, {
            buySignature: buy.signature,
            ...(settleSignature ? { settleSignature } : {}),
        });
    }

    const operatorSigner = await createKeyPairSignerFromBytes(config.operator.secretKey);
    const addressClient = createClient()
        .use(signerPlugin(operatorSigner))
        .use(solanaRpc({ rpcUrl: config.rpcUrl }))
        .use(gachaProgram());
    const [mint] = await addressClient.gacha.pdas.prizeMint({ pull: buy.pull });
    const [buyerAta] = await findAssociatedTokenPda({
        mint,
        owner: buy.buyer,
        tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
    });

    let claimSignature: string | null = null;
    if (pull.status === PULL_STATUS_SETTLED) {
        try {
            const claimed = await claimSettledPull(config, buy.pull, buy.buyer);
            claimSignature = claimed.signature;
        } catch (cause) {
            const concurrentInfo = await connection.getAccountInfo(pullKey, 'confirmed');
            const concurrentPull = concurrentInfo ? getPullDecoder().decode(new Uint8Array(concurrentInfo.data)) : null;
            if (concurrentPull?.status === PULL_STATUS_CLAIMED) {
                pull = concurrentPull;
            } else if (cause instanceof PullProcessError) {
                throw new PullProcessError(cause.stage, cause.code, cause.message, cause.retryable, {
                    ...cause.signatures,
                    buySignature: buy.signature,
                    ...(settleSignature ? { settleSignature } : {}),
                });
            } else {
                throw cause;
            }
        }
    }

    return {
        buySignature: buy.signature,
        buyer: buy.buyer,
        buyerAta,
        claimSignature,
        mint,
        pull: buy.pull,
        rarity: RARITY_LABELS[pull.tierSelected] ?? `tier ${pull.tierSelected}`,
        settleSignature,
        status: 'claimed',
        tier: pull.tierSelected,
    };
}
