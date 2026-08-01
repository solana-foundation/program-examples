import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Development-only CORS bridge to a local Solana validator. */
export async function POST(request: Request): Promise<Response> {
    if (process.env.NODE_ENV !== 'development') {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const response = await fetch('http://127.0.0.1:8899', {
        body: await request.text(),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
    });
    return new Response(response.body, {
        headers: { 'content-type': response.headers.get('content-type') ?? 'application/json' },
        status: response.status,
    });
}
