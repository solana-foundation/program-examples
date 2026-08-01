import { rarityColor } from '@/lib/gacha';
import { cn } from '@/lib/utils';

/** A small pill showing a tier's rarity label in its accent color. */
export function RarityBadge({ tier, label, className }: { tier: number; label: string; className?: string }) {
    const color = rarityColor(tier);
    return (
        <span
            className={cn(
                'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold capitalize',
                className,
            )}
            style={{ backgroundColor: `color-mix(in oklch, ${color} 16%, transparent)`, color }}
        >
            {label}
        </span>
    );
}
