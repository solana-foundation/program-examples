'use client';

import { type Pool, type Pull, pullAlpha, selectTier, verifyPull } from '@solana/gacha';
import { address, getAddressEncoder } from '@solana/kit';
import { Check, ShieldCheck, X } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useAppClient } from '@/lib/client-provider';
import { PullStatus, RARITY_LABELS } from '@/lib/gacha';

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
    return a.length === b.length && a.every((x, i) => x === b[i]);
}

function toHex(bytes: Uint8Array): string {
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array {
    const clean = hex.trim().replace(/^0x/, '').replace(/\s+/g, '');
    if (clean.length % 2 !== 0) throw new Error('odd-length hex');
    const out = new Uint8Array(clean.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    return out;
}

type Loaded = { pull: Pull; pool: Pool; alphaOk: boolean; reproducedTier: number | null; tierOk: boolean | null };

export function VerifyPanel({ initialPull = '' }: { initialPull?: string }) {
    const client = useAppClient();
    const [input, setInput] = useState(initialPull);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [loaded, setLoaded] = useState<Loaded | null>(null);
    const [proofHex, setProofHex] = useState('');
    const [proofOk, setProofOk] = useState<boolean | null>(null);

    async function load() {
        setLoading(true);
        setError(null);
        setLoaded(null);
        setProofOk(null);
        try {
            const pullAddress = address(input.trim());
            const pullAccount = await client.gacha.accounts.pull.fetchMaybe(pullAddress);
            if (!pullAccount.exists) throw new Error('No pull account at that address');
            const pull = pullAccount.data;
            const poolAccount = await client.gacha.accounts.pool.fetchMaybe(pull.pool);
            if (!poolAccount.exists) throw new Error('Pool not found for this pull');
            const pool = poolAccount.data;

            const clientSeed = Uint8Array.from(pull.clientSeed);
            const recomputedAlpha = pullAlpha(pullAddress, clientSeed);
            const alphaOk = bytesEqual(recomputedAlpha, Uint8Array.from(pull.alpha));

            let reproducedTier: number | null = null;
            let tierOk: boolean | null = null;
            if (pull.status !== PullStatus.Pending) {
                reproducedTier = selectTier(Uint8Array.from(pull.beta), pool.weights, pool.tierCount);
                tierOk = reproducedTier === pull.tierSelected;
            }
            setLoaded({ pull, pool, alphaOk, reproducedTier, tierOk });
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setLoading(false);
        }
    }

    function checkProof() {
        if (!loaded) return;
        try {
            const proof = fromHex(proofHex);
            const operatorBytes = new Uint8Array(getAddressEncoder().encode(loaded.pool.operator));
            const alpha = Uint8Array.from(loaded.pull.alpha);
            setProofOk(verifyPull(operatorBytes, alpha, proof));
        } catch {
            setProofOk(false);
        }
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <ShieldCheck className="size-4" /> Verify a pull
                </CardTitle>
                <CardDescription>
                    Recompute the outcome from on-chain data. The VRF input{' '}
                    <code>alpha = SHA-256(pull || client_seed)</code> and the selected tier are pure functions of the
                    stored seed and the operator’s <code>beta</code> — so anyone can reproduce them.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="flex gap-2">
                    <Input
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        placeholder="Pull address"
                        className="font-mono text-xs"
                    />
                    <Button onClick={() => void load()} disabled={loading || !input.trim()}>
                        {loading ? 'Loading…' : 'Verify'}
                    </Button>
                </div>

                {error && <p className="text-sm text-destructive">{error}</p>}

                {loaded && (
                    <div className="space-y-3">
                        <CheckRow ok={loaded.alphaOk} label="alpha = SHA-256(pull || client_seed) matches on-chain" />
                        {loaded.tierOk != null ? (
                            <CheckRow
                                ok={loaded.tierOk}
                                label={`tier reproduced from beta → ${RARITY_LABELS[loaded.reproducedTier ?? 0]} (matches recorded)`}
                            />
                        ) : (
                            <p className="text-sm text-muted-foreground">
                                Pull is still pending — no beta to reproduce yet.
                            </p>
                        )}

                        <dl className="grid gap-1 rounded-xl border bg-secondary/40 p-3 font-mono text-[11px] break-all text-muted-foreground">
                            <Field label="alpha" value={toHex(Uint8Array.from(loaded.pull.alpha))} />
                            {loaded.pull.status !== PullStatus.Pending && (
                                <Field label="beta" value={toHex(Uint8Array.from(loaded.pull.beta))} />
                            )}
                            <Field label="operator" value={loaded.pool.operator} />
                        </dl>

                        {loaded.pull.status !== PullStatus.Pending && (
                            <div className="space-y-2 border-t pt-3">
                                <div className="text-xs text-muted-foreground">
                                    Full ECVRF proof check — paste the 80-byte proof from the pull’s{' '}
                                    <code>PullSettledEvent</code> (emitted by settle / logged by the operator).
                                </div>
                                <div className="flex gap-2">
                                    <Input
                                        value={proofHex}
                                        onChange={e => setProofHex(e.target.value)}
                                        placeholder="proof (hex)"
                                        className="font-mono text-xs"
                                    />
                                    <Button variant="secondary" onClick={checkProof} disabled={!proofHex.trim()}>
                                        Check proof
                                    </Button>
                                </div>
                                {proofOk != null && (
                                    <CheckRow
                                        ok={proofOk}
                                        label={
                                            proofOk
                                                ? 'ECVRF proof verifies for this operator'
                                                : 'ECVRF proof does NOT verify'
                                        }
                                    />
                                )}
                            </div>
                        )}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

function CheckRow({ ok, label }: { ok: boolean; label: string }) {
    return (
        <div className="flex items-center gap-2 text-sm">
            {ok ? (
                <Check className="size-4 shrink-0 text-emerald-600" />
            ) : (
                <X className="size-4 shrink-0 text-destructive" />
            )}
            <span className={ok ? '' : 'text-destructive'}>{label}</span>
        </div>
    );
}

function Field({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex gap-2">
            <dt className="shrink-0 text-foreground/70">{label}</dt>
            <dd>{value}</dd>
        </div>
    );
}
