import type { Address } from '@solana/kit';

/** Successful response from the unified pull API. */
export interface PullSuccess {
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

/** Structured failure returned by the unified pull API. */
export interface PullFailure {
    readonly buySignature?: string;
    readonly claimSignature?: string;
    readonly code: string;
    readonly message: string;
    readonly retryable: boolean;
    readonly settleSignature?: string;
    readonly stage: 'claim' | 'request' | 'settle' | 'submit' | 'validation';
}

/** Error carrying a structured pull API failure. */
export class PullApiError extends Error {
    override readonly name = 'PullApiError';

    constructor(readonly failure: PullFailure) {
        super(failure.message);
    }
}

/** Sends a signed buy transaction to the server-side pull orchestrator. */
export async function processPull(buyer: Address, signedBuyTransaction: string): Promise<PullSuccess> {
    const response = await fetch('/api/pull', {
        body: JSON.stringify({ buyer, signedBuyTransaction }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
    });
    const payload: unknown = await response.json();
    if (!response.ok) {
        throw new PullApiError(payload as PullFailure);
    }
    return payload as PullSuccess;
}
