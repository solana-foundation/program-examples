/** The proposal status shown alongside a SIMD-inspired collectible card. */
export type SimdStatus = 'Activated' | 'Implemented' | 'Review';

/** Display metadata for one card in the SIMD All-Stars set. */
export type SimdCard = {
    readonly character: string;
    readonly href: string;
    readonly image: string;
    readonly number: string;
    readonly role: string;
    readonly status: SimdStatus;
    readonly summary: string;
    readonly title: string;
};

const SIMD_REPOSITORY = 'https://github.com/solana-foundation/solana-improvement-documents/blob/main/proposals';

/**
 * The first SIMD All-Stars set, ordered to match the gacha rarity tiers.
 *
 * Card rarity is a property of the pull and does not represent the proposal's
 * technical importance or governance status.
 */
export const SIMD_CARDS: readonly SimdCard[] = [
    {
        character: 'Sera Call',
        href: `${SIMD_REPOSITORY}/0178-static-syscalls.md`,
        image: '/cards/simd/simd-0178-static-syscalls.jpg',
        number: '0178',
        role: 'Play caller',
        status: 'Review',
        summary: 'Resolves syscall calls at link time to avoid runtime relocations.',
        title: 'SBPF Static Syscalls',
    },
    {
        character: 'Tavi Tempo',
        href: `${SIMD_REPOSITORY}/0033-timely-vote-credits.md`,
        image: '/cards/simd/simd-0033-timely-vote-credits.jpg',
        number: '0033',
        role: 'Vote sprinter',
        status: 'Activated',
        summary: 'Rewards lower-latency validator votes with more vote credits.',
        title: 'Timely Vote Credits',
    },
    {
        character: 'Cora Meter',
        href: `${SIMD_REPOSITORY}/0182-conditional-cu-metering.md`,
        image: '/cards/simd/simd-0182-cu-metering.jpg',
        number: '0182',
        role: 'Budget keeper',
        status: 'Implemented',
        summary: 'Charges all requested compute units when the VM exits through an irregular failure.',
        title: 'Consume Requested CUs for sBPF Failures',
    },
    {
        character: 'Dani Stack',
        href: `${SIMD_REPOSITORY}/0166-dynamic-stack-frames.md`,
        image: '/cards/simd/simd-0166-dynamic-stack-frames.jpg',
        number: '0166',
        role: 'Frame gymnast',
        status: 'Implemented',
        summary: 'Lets programs manage stack space dynamically instead of reserving identical fixed frames.',
        title: 'SBPF Dynamic Stack Frames',
    },
    {
        character: 'Lena Lattice',
        href: `${SIMD_REPOSITORY}/0215-accounts-lattice-hash.md`,
        image: '/cards/simd/simd-0215-accounts-lattice-hash.jpg',
        number: '0215',
        role: 'Hash keeper',
        status: 'Activated',
        summary: "Maintains a fast incremental hash of the network's total account state.",
        title: 'Homomorphic Hashing of Account State',
    },
    {
        character: 'Mika Porter',
        href: `${SIMD_REPOSITORY}/0296-larger-transactions.md`,
        image: '/cards/simd/simd-0296-larger-transactions.jpg',
        number: '0296',
        role: 'Payload carrier',
        status: 'Review',
        summary: 'Proposes expanding transaction payloads from 1,232 bytes to 4,096 bytes.',
        title: 'Larger Transaction Size',
    },
    {
        character: 'Vera One',
        href: `${SIMD_REPOSITORY}/0385-transaction-v1.md`,
        image: '/cards/simd/simd-0385-transaction-v1.jpg',
        number: '0385',
        role: 'Format captain',
        status: 'Review',
        summary: 'Proposes a streamlined transaction format with configuration carried in the header.',
        title: 'Transaction V1 Format',
    },
    {
        character: 'Alba Glow',
        href: `${SIMD_REPOSITORY}/0326-alpenglow.md`,
        image: '/cards/simd/simd-0326-alpenglow.jpg',
        number: '0326',
        role: 'Consensus climber',
        status: 'Review',
        summary: 'Proposes a more resilient consensus protocol with dramatically lower finality latency.',
        title: 'Alpenglow',
    },
];

/**
 * Returns the SIMD card assigned to a gacha rarity tier.
 *
 * @param tier - Zero-based rarity tier selected by the on-chain pull.
 * @return The matching card, clamped to the available set.
 */
export function simdCardForTier(tier: number): SimdCard {
    const safeTier = Number.isInteger(tier) ? Math.min(Math.max(tier, 0), SIMD_CARDS.length - 1) : 0;
    return SIMD_CARDS[safeTier] ?? SIMD_CARDS[0]!;
}
