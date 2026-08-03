import 'server-only';

import { provePull, type Pull, pullAlpha, RARITY_LABELS } from '@solana/gacha';
import { buildSettleContext } from '@solana/gacha/reveal-context';
import { type Address, type Base64EncodedWireTransaction, getBase64Decoder, type Signature } from '@solana/kit';
import { findAssociatedTokenPda, TOKEN_2022_PROGRAM_ADDRESS } from '@solana-program/token-2022';

import type { PullClient, PullServerConfig } from './pull-config';
import { PullProcessError } from './pull-error';
import type { ValidatedBuy } from './validate-buy';

const PULL_STATUS_PENDING = 0;
const PULL_STATUS_SETTLED = 1;
const PULL_STATUS_CLAIMED = 2;
const CONFIRM_TIMEOUT_MS = 30_000;
const CONFIRM_POLL_MS = 1_000;

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

function isConfirmed(status: { confirmationStatus?: string | null } | null | undefined): boolean {
    return status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized';
}

async function signatureStatus(client: PullClient, signature: string) {
    const response = await client.rpc
        .getSignatureStatuses([signature as Signature], { searchTransactionHistory: true })
        .send();
    return response.value[0];
}

async function confirmSignature(client: PullClient, signature: string): Promise<void> {
    const deadline = Date.now() + CONFIRM_TIMEOUT_MS;
    for (;;) {
        const status = await signatureStatus(client, signature);
        if (status?.err) throw new Error('transaction failed on-chain');
        if (isConfirmed(status)) return;
        if (Date.now() > deadline) throw new Error('confirmation timed out');
        await new Promise(resolve => setTimeout(resolve, CONFIRM_POLL_MS));
    }
}

async function confirmedOrSubmit(client: PullClient, buy: ValidatedBuy): Promise<void> {
    const existing = await signatureStatus(client, buy.signature);
    if (existing?.err) {
        throw new PullProcessError('submit', 'buy_failed', 'The signed buy transaction failed on-chain.', false, {
            buySignature: buy.signature,
        });
    }
    if (isConfirmed(existing)) return;

    try {
        const wireTransaction = getBase64Decoder().decode(buy.rawTransaction) as Base64EncodedWireTransaction;
        await client.rpc
            .sendTransaction(wireTransaction, {
                encoding: 'base64',
                preflightCommitment: 'confirmed',
                skipPreflight: false,
            })
            .send();
        await confirmSignature(client, buy.signature);
    } catch {
        const status = await signatureStatus(client, buy.signature);
        if (status && !status.err && isConfirmed(status)) return;
        throw new PullProcessError(
            'submit',
            'buy_not_confirmed',
            'The buy transaction was not confirmed. Its blockhash may have expired.',
            false,
            { buySignature: buy.signature },
        );
    }
}

async function settlePendingPull(
    client: PullClient,
    config: PullServerConfig,
    pullAddress: Address,
    pullData: Pull,
): Promise<string> {
    const pool = await client.gacha.accounts.pool.fetchMaybe(config.poolAddress);
    if (!pool.exists)
        throw new PullProcessError('settle', 'pool_not_found', 'The configured pool no longer exists.', false);
    if (pool.data.operator !== config.operator.address) {
        throw new PullProcessError(
            'settle',
            'operator_mismatch',
            'The configured key is not this pool’s operator.',
            false,
        );
    }

    const alpha = pullAlpha(pullAddress, Uint8Array.from(pullData.clientSeed));
    if (!bytesEqual(alpha, Uint8Array.from(pullData.alpha))) {
        throw new PullProcessError('settle', 'alpha_mismatch', 'The pull alpha does not match its client seed.', false);
    }
    const { beta, proof } = provePull(config.operatorSecret.slice(0, 32), alpha);

    const context = await buildSettleContext(config.rpcUrl, {
        authorityLabel: Uint8Array.from(pool.data.authorityLabel),
        operator: config.operator.address,
        pull: pullAddress,
    });
    if (!context || !context.frozen) {
        throw new PullProcessError(
            'settle',
            'operator_not_frozen',
            'The operator’s cc-vrf authority is unavailable.',
            false,
        );
    }

    const settlePullData = { beta: Array.from(beta), light: context.light, proof: Array.from(proof) };
    const candidates =
        context.outputQueue === context.authorityQueue
            ? [context.outputQueue]
            : [context.outputQueue, context.authorityQueue];
    let lastError: unknown;
    for (const outputQueue of candidates) {
        try {
            const { context: txContext } = await client.gacha.instructions
                .settlePull({
                    addressTree: context.addressTree,
                    authorityQueue: context.authorityQueue,
                    authorityStateTree: context.authorityStateTree,
                    operator: config.operator,
                    outputQueue,
                    pool: config.poolAddress,
                    pull: pullAddress,
                    settlePullData,
                })
                .sendTransaction();
            return txContext.signature;
        } catch (error) {
            lastError = error;
        }
    }
    const detail = lastError instanceof Error ? lastError.message : String(lastError);
    throw new PullProcessError(
        'settle',
        'settle_failed',
        `The reveal transaction failed: ${detail}. Retry to resume from the pull’s on-chain state.`,
        true,
    );
}

async function claimSettledPull(
    client: PullClient,
    config: PullServerConfig,
    pullAddress: Address,
    buyer: Address,
): Promise<{ buyerAta: Address; mint: Address; signature: string }> {
    const [mint] = await client.gacha.pdas.prizeMint({ pull: pullAddress });
    const [buyerAta] = await findAssociatedTokenPda({ mint, owner: buyer, tokenProgram: TOKEN_2022_PROGRAM_ADDRESS });
    try {
        const { context } = await client.gacha.instructions
            .claimPrize({ buyer, buyerAta, mint, payer: config.operator, pool: config.poolAddress, pull: pullAddress })
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
    client: PullClient,
    config: PullServerConfig,
    buy: ValidatedBuy,
): Promise<OrchestratedPull> {
    await confirmedOrSubmit(client, buy);

    const created = await client.gacha.accounts.pull.fetchMaybe(buy.pull);
    if (!created.exists) {
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
    let pull: Pull = created.data;
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
            settleSignature = await settlePendingPull(client, config, buy.pull, pull);
        } catch (cause) {
            const concurrent = await client.gacha.accounts.pull.fetchMaybe(buy.pull);
            if (concurrent.exists && concurrent.data.status !== PULL_STATUS_PENDING) {
                pull = concurrent.data;
            } else if (cause instanceof PullProcessError) {
                throw new PullProcessError(cause.stage, cause.code, cause.message, cause.retryable, {
                    ...cause.signatures,
                    buySignature: buy.signature,
                });
            } else {
                throw cause;
            }
        }
        const settled = await client.gacha.accounts.pull.fetchMaybe(buy.pull);
        if (!settled.exists)
            throw new PullProcessError('settle', 'pull_not_found', 'The settled pull disappeared.', true);
        pull = settled.data;
    }
    if (pull.status !== PULL_STATUS_SETTLED && pull.status !== PULL_STATUS_CLAIMED) {
        throw new PullProcessError('settle', 'pull_not_settled', 'The pull did not reach the settled state.', true, {
            buySignature: buy.signature,
            ...(settleSignature ? { settleSignature } : {}),
        });
    }

    const [mint] = await client.gacha.pdas.prizeMint({ pull: buy.pull });
    const [buyerAta] = await findAssociatedTokenPda({
        mint,
        owner: buy.buyer,
        tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
    });

    let claimSignature: string | null = null;
    if (pull.status === PULL_STATUS_SETTLED) {
        try {
            const claimed = await claimSettledPull(client, config, buy.pull, buy.buyer);
            claimSignature = claimed.signature;
        } catch (cause) {
            const concurrent = await client.gacha.accounts.pull.fetchMaybe(buy.pull);
            if (concurrent.exists && concurrent.data.status === PULL_STATUS_CLAIMED) {
                pull = concurrent.data;
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
