/** Maximum number of reward tiers a pool can define. */
export const MAX_TIERS = 8;

/** `tierSelected` sentinel while a pull is still pending. */
export const TIER_UNSET = 255;

/** RFC 9381 ciphersuite used by the operator's ECVRF (matches cc-vrf). */
export const ECVRF_SUITE = 'ECVRF-EDWARDS25519-SHA512-TAI';
