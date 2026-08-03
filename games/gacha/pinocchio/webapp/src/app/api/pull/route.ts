import { NextResponse } from 'next/server';

import { orchestratePull } from '@/server/orchestrate-pull';
import { createPullClient, loadPullServerConfig } from '@/server/pull-config';
import { PullProcessError } from '@/server/pull-error';
import { validateSignedBuy } from '@/server/validate-buy';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;
export const runtime = 'nodejs';

interface PullRequestBody {
    readonly buyer: string;
    readonly signedBuyTransaction: string;
}

function isPullRequestBody(value: unknown): value is PullRequestBody {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as Record<string, unknown>;
    return typeof candidate.buyer === 'string' && typeof candidate.signedBuyTransaction === 'string';
}

/** Runs the complete signed-buy, reveal, and mint pipeline. */
export async function POST(request: Request): Promise<NextResponse> {
    try {
        const body: unknown = await request.json();
        if (!isPullRequestBody(body)) {
            throw new PullProcessError(
                'request',
                'invalid_request',
                'Expected a buyer and signed buy transaction.',
                false,
            );
        }
        const config = await loadPullServerConfig();
        const client = createPullClient(config);
        const buy = await validateSignedBuy(client, config, body.buyer, body.signedBuyTransaction);
        return NextResponse.json(await orchestratePull(client, config, buy));
    } catch (cause) {
        const error =
            cause instanceof PullProcessError
                ? cause
                : new PullProcessError('request', 'internal_error', 'The pull service failed unexpectedly.', true);
        if (!(cause instanceof PullProcessError)) console.error('Unexpected pull API failure', cause);
        const status = error.stage === 'validation' || error.stage === 'request' ? 400 : error.retryable ? 503 : 409;
        return NextResponse.json(
            {
                code: error.code,
                message: error.message,
                retryable: error.retryable,
                stage: error.stage,
                ...error.signatures,
            },
            { status },
        );
    }
}
