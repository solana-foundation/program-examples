const LAMPORTS_PER_SOL = 1_000_000_000n;

/** Lamports to a human SOL string (e.g. `0.1`, `1,250`). */
export function formatSol(lamports: bigint | number, fractionDigits = 4): string {
    return (Number(lamports) / 1e9).toLocaleString(undefined, { maximumFractionDigits: fractionDigits });
}

/** SOL (as a number from a form field) to lamports. */
export function solToLamports(sol: number): bigint {
    const whole = Math.trunc(sol);
    const frac = sol - whole;
    return BigInt(whole) * LAMPORTS_PER_SOL + BigInt(Math.round(frac * Number(LAMPORTS_PER_SOL)));
}

/** A wallet address as `abcd…wxyz` for compact display. */
export function shortenAddress(addr: string): string {
    return addr.length > 10 ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : addr;
}
