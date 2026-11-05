use anchor_lang::prelude::*;

#[error_code]
pub enum StakeError {
    #[msg("This NFT does not belong to any collection")]
    MissingCollection,
    #[msg("This NFT's collection is not the one this pool accepts")]
    InvalidCollection,
    #[msg("This NFT's collection has not been verified by the collection authority")]
    UnverifiedCollection,
    #[msg("The token account does not hold the NFT being staked")]
    NftNotHeld,
    #[msg("This user has already staked the maximum number of NFTs")]
    MaxStakeReached,
    #[msg("This stake position belongs to another user")]
    InvalidOwner,
    #[msg("The freeze period has not elapsed yet")]
    FreezePeriodNotPassed,
    #[msg("No whole day has elapsed since the last claim")]
    NothingToClaim,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Pool settings would let rewards overflow, or allow no stakes at all")]
    InvalidConfig,
}
