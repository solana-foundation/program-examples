import { findAssociatedTokenPda, TOKEN_2022_PROGRAM_ADDRESS } from '@solana-program/token-2022';
import { GACHA_PROGRAM_ADDRESS, type Pool, type Pull, PullStatus, RARITY_LABELS } from '@solana/gacha';
import type { Address } from '@solana/kit';

export { GACHA_PROGRAM_ADDRESS, PullStatus, RARITY_LABELS };

/** Byte size of a Pull account — used as a `getProgramAccounts` dataSize filter. */
export const PULL_ACCOUNT_SIZE = 220n;

/** Field offsets inside a Pull account (for memcmp filters). */
export const PULL_OFFSET = { pool: 4n, buyer: 36n } as const;

/** 32 fresh random bytes of buyer entropy, committed into the VRF input. */
export function newClientSeed(): Uint8Array {
    const seed = new Uint8Array(32);
    crypto.getRandomValues(seed);
    return seed;
}

/** A cc-vrf authority label (a string) as the fixed 32-byte array the program stores. */
export function labelToBytes(label: string): number[] {
    const bytes = new Uint8Array(32);
    bytes.set(new TextEncoder().encode(label).slice(0, 32));
    return Array.from(bytes);
}

/** Reads a stored 32-byte authority label back to a string. */
export function labelToString(label: number[]): string {
    return new TextDecoder().decode(Uint8Array.from(label)).replace(/\0+$/, '');
}

/** The buyer's associated Token-2022 account for a prize mint. */
export async function findBuyerAta(buyer: Address, mint: Address): Promise<Address> {
    const [ata] = await findAssociatedTokenPda({ owner: buyer, mint, tokenProgram: TOKEN_2022_PROGRAM_ADDRESS });
    return ata;
}

export type TierOdds = { tier: number; label: string; weight: number; pct: number };

/** Per-tier drop odds from a pool's fixed weights. */
export function tierOdds(pool: Pick<Pool, 'tierCount' | 'weights'>): TierOdds[] {
    const count = pool.tierCount;
    const weights = pool.weights.slice(0, count);
    const total = weights.reduce((a, w) => a + w, 0);
    return weights.map((weight, tier) => ({
        tier,
        label: RARITY_LABELS[tier] ?? `tier ${tier}`,
        weight,
        pct: total === 0 ? 0 : (weight / total) * 100,
    }));
}

/** A tier's rarity label, or `null` while the pull is still pending. */
export function rarityLabel(pull: Pick<Pull, 'tierSelected' | 'status'>): string | null {
    if (pull.status === PullStatus.Pending) return null;
    return RARITY_LABELS[pull.tierSelected] ?? `tier ${pull.tierSelected}`;
}

/** CSS custom property for a tier's accent color (defined in index.css `@theme`). */
export function rarityColor(tier: number): string {
    const label = RARITY_LABELS[tier] ?? 'common';
    return `var(--color-rarity-${label})`;
}

/** The first slot after which a still-pending pull can be refunded. */
export function pullRefundSlot(pull: Pick<Pull, 'requestedSlot'>, pool: Pick<Pool, 'settleDeadlineSlots'>): bigint {
    return pull.requestedSlot + pool.settleDeadlineSlots + 1n;
}

/** Whether the buyer can refund a pending pull at the current slot. */
export function isPullRefundable(
    pull: Pick<Pull, 'requestedSlot' | 'status'>,
    pool: Pick<Pool, 'settleDeadlineSlots'>,
    currentSlot: bigint | null,
): boolean {
    return currentSlot !== null && pull.status === PullStatus.Pending && currentSlot >= pullRefundSlot(pull, pool);
}

export function statusLabel(status: number): 'Pending' | 'Settled' | 'Claimed' {
    if (status === PullStatus.Settled) return 'Settled';
    if (status === PullStatus.Claimed) return 'Claimed';
    return 'Pending';
}
