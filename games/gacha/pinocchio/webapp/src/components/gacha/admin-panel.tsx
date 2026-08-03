import { MAX_TIERS } from '@solana/gacha';
import { address } from '@solana/kit';
import { useState } from 'react';
import { toast } from 'sonner';

import { PoolSummary } from '@/components/gacha/pool-summary';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { usePool } from '@/hooks/use-pool';
import { useSend } from '@/hooks/use-send';
import { useWallet } from '@/hooks/use-wallet';
import { formatSol, solToLamports } from '@/lib/format';
import { labelToBytes } from '@/lib/gacha';

export function AdminPanel() {
    const { address: wallet } = useWallet();
    const { pool, refresh } = usePool(wallet);

    if (!wallet) {
        return <Empty>Connect a wallet to manage a pool.</Empty>;
    }

    if (pool) {
        return (
            <div className="space-y-6">
                <PoolSummary pool={pool} />
                <WithdrawCard pool={pool} onDone={refresh} />
            </div>
        );
    }

    return <InitCard onDone={refresh} />;
}

function InitCard({ onDone }: { onDone: () => void }) {
    const { client, signer } = useWallet();
    const { run, isSending } = useSend();
    const [operator, setOperator] = useState('');
    const [label, setLabel] = useState('gacha-demo');
    const [feeSol, setFeeSol] = useState('0.05');
    const [deadline, setDeadline] = useState('300');
    const [weights, setWeights] = useState('28, 23, 18, 14, 9, 4, 3, 1');

    async function submit() {
        if (!signer) return;
        let operatorAddr;
        try {
            operatorAddr = address(operator.trim());
        } catch {
            toast.error('Enter a valid operator address');
            return;
        }
        const parsed = weights
            .split(',')
            .map(w => w.trim())
            .filter(w => w.length > 0)
            .map(Number);
        if (parsed.length === 0 || parsed.length > MAX_TIERS || parsed.some(w => !Number.isInteger(w) || w <= 0)) {
            toast.error(`Enter 1–${MAX_TIERS} positive whole-number tier weights`);
            return;
        }
        const padded = [...parsed, ...Array(MAX_TIERS - parsed.length).fill(0)];

        const ix = await client.gacha.instructions.initPool({
            admin: signer,
            initPoolData: {
                authorityLabel: labelToBytes(label.trim()),
                entryFee: solToLamports(Number(feeSol)),
                operator: operatorAddr,
                settleDeadlineSlots: BigInt(Math.max(0, Math.floor(Number(deadline)))),
                tierCount: parsed.length,
                weights: padded,
            },
        });
        const sig = await run(ix, 'Pool created');
        if (sig) onDone();
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>Create a pool</CardTitle>
                <CardDescription>
                    Your wallet becomes the pool admin. The operator must be a key registered and frozen in the cc-vrf
                    registry (see <code>scripts/register-operator.ts</code>) for reveals to settle.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
                <Labeled label="Operator address (cc-vrf key)">
                    <Input
                        value={operator}
                        onChange={e => setOperator(e.target.value)}
                        placeholder="operator pubkey"
                        className="font-mono text-xs"
                    />
                </Labeled>
                <div className="grid grid-cols-2 gap-3">
                    <Labeled label="cc-vrf label">
                        <Input value={label} onChange={e => setLabel(e.target.value)} />
                    </Labeled>
                    <Labeled label="Entry fee (SOL)">
                        <Input
                            value={feeSol}
                            onChange={e => setFeeSol(e.target.value)}
                            type="number"
                            min="0"
                            step="0.01"
                        />
                    </Labeled>
                </div>
                <div className="grid grid-cols-2 gap-3">
                    <Labeled label="Refund deadline (slots)">
                        <Input value={deadline} onChange={e => setDeadline(e.target.value)} type="number" min="0" />
                    </Labeled>
                    <Labeled label={`Tier weights (max ${MAX_TIERS})`}>
                        <Input
                            value={weights}
                            onChange={e => setWeights(e.target.value)}
                            placeholder="28, 23, 18, 14, 9, 4, 3, 1"
                        />
                    </Labeled>
                </div>
                <Button className="w-full" onClick={() => void submit()} disabled={isSending}>
                    {isSending ? 'Creating…' : 'Create pool'}
                </Button>
            </CardContent>
        </Card>
    );
}

function WithdrawCard({ pool, onDone }: { pool: NonNullable<ReturnType<typeof usePool>['pool']>; onDone: () => void }) {
    const { client, signer } = useWallet();
    const { run, isSending } = useSend();
    const [amountSol, setAmountSol] = useState('');

    async function submit() {
        if (!signer) return;
        const amount = solToLamports(Number(amountSol));
        if (amount <= 0n) {
            toast.error('Enter an amount to withdraw');
            return;
        }
        const ix = await client.gacha.instructions.withdrawFees({
            admin: signer,
            pool: pool.poolAddress,
            vault: pool.vaultAddress,
            withdrawFeesData: { amount },
        });
        const sig = await run(ix, 'Fees withdrawn');
        if (sig) {
            setAmountSol('');
            onDone();
        }
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>Withdraw fees</CardTitle>
                <CardDescription>
                    Drains settled revenue only — the vault always reserves {pool.pool.pendingPulls.toString()} pending
                    buyers’ escrow ({formatSol(pool.pool.entryFee * pool.pool.pendingPulls)} SOL) plus rent.
                </CardDescription>
            </CardHeader>
            <CardContent className="flex gap-2">
                <Input
                    value={amountSol}
                    onChange={e => setAmountSol(e.target.value)}
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Amount (SOL)"
                />
                <Button onClick={() => void submit()} disabled={isSending || !amountSol}>
                    {isSending ? 'Withdrawing…' : 'Withdraw'}
                </Button>
            </CardContent>
        </Card>
    );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <label className="block space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">{label}</span>
            {children}
        </label>
    );
}

function Empty({ children }: { children: React.ReactNode }) {
    return (
        <Card>
            <CardContent className="py-12 text-center text-sm text-muted-foreground">{children}</CardContent>
        </Card>
    );
}
