/** Maximum number of reward tiers a pool can define. */
export const MAX_TIERS = 8;

/** RFC 9381 ciphersuite used by the operator's ECVRF. */
export const ECVRF_SUITE = 'ECVRF-EDWARDS25519-SHA512-TAI';

/**
 * Rarity label per tier index, mirrored from the on-chain `RARITY_LABELS`.
 * Recorded in each prize NFT's Token-2022 metadata under the `"rarity"` key.
 */
export const RARITY_LABELS = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'exotic', 'divine'] as const;

/**
 * `additional_metadata` keys of the prize NFT, mirrored from the on-chain
 * constants. All values except `rarity` are lowercase hex.
 */
export const METADATA_RARITY_KEY = 'rarity';
export const METADATA_PULL_KEY = 'pull';
export const METADATA_CLIENT_SEED_KEY = 'client_seed';
export const METADATA_BETA_KEY = 'beta';
export const METADATA_PROOF_KEY = 'proof';
