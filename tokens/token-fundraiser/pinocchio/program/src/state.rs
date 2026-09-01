use pinocchio::error::ProgramError;

/// Persistent state of a fundraiser, stored in the fundraiser PDA.
///
/// The fundraiser PDA is derived from `[b"fundraiser", maker]` and is the
/// authority of the vault token account that holds contributed tokens.
///
/// Serialized byte layout (little-endian), matching the field order below:
/// `[maker: 32][mint_to_raise: 32][amount_to_raise: u64][current_amount: u64]
///  [time_started: i64][duration: u16][bump: u8]`
pub struct Fundraiser {
    /// The wallet that created the fundraiser and receives the funds.
    pub maker: [u8; 32],
    /// Mint of the token being raised.
    pub mint_to_raise: [u8; 32],
    /// Target amount to raise before the funds can be released.
    pub amount_to_raise: u64,
    /// Amount contributed so far.
    pub current_amount: u64,
    /// Unix timestamp when the fundraiser started.
    pub time_started: i64,
    /// Fundraiser duration, in days.
    pub duration: u16,
    /// Canonical bump for the fundraiser PDA.
    pub bump: u8,
}

impl Fundraiser {
    /// Seed prefix for the fundraiser PDA: `[SEED_PREFIX, maker]`.
    pub const SEED_PREFIX: &'static [u8] = b"fundraiser";

    /// Serialized size in bytes.
    pub const LEN: usize = 32 + 32 + 8 + 8 + 8 + 2 + 1;

    pub fn serialize(&self, dst: &mut [u8]) -> Result<(), ProgramError> {
        let dst = dst.get_mut(..Self::LEN).ok_or(ProgramError::AccountDataTooSmall)?;
        dst[0..32].copy_from_slice(&self.maker);
        dst[32..64].copy_from_slice(&self.mint_to_raise);
        dst[64..72].copy_from_slice(&self.amount_to_raise.to_le_bytes());
        dst[72..80].copy_from_slice(&self.current_amount.to_le_bytes());
        dst[80..88].copy_from_slice(&self.time_started.to_le_bytes());
        dst[88..90].copy_from_slice(&self.duration.to_le_bytes());
        dst[90] = self.bump;
        Ok(())
    }

    pub fn deserialize(src: &[u8]) -> Result<Self, ProgramError> {
        let src: &[u8; Self::LEN] =
            src.get(..Self::LEN).and_then(|s| s.try_into().ok()).ok_or(ProgramError::InvalidAccountData)?;
        Ok(Self {
            maker: src[0..32].try_into().unwrap(),
            mint_to_raise: src[32..64].try_into().unwrap(),
            amount_to_raise: u64::from_le_bytes(src[64..72].try_into().unwrap()),
            current_amount: u64::from_le_bytes(src[72..80].try_into().unwrap()),
            time_started: i64::from_le_bytes(src[80..88].try_into().unwrap()),
            duration: u16::from_le_bytes(src[88..90].try_into().unwrap()),
            bump: src[90],
        })
    }
}

/// Per-contributor record of how much a wallet has contributed, stored in the
/// contributor PDA derived from `[b"contributor", fundraiser, contributor]`.
///
/// Serialized byte layout: `[amount: u64]` (little-endian).
pub struct Contributor {
    pub amount: u64,
}

impl Contributor {
    /// Seed prefix for the contributor PDA: `[SEED_PREFIX, fundraiser, contributor]`.
    pub const SEED_PREFIX: &'static [u8] = b"contributor";

    /// Serialized size in bytes.
    pub const LEN: usize = 8;

    pub fn serialize(&self, dst: &mut [u8]) -> Result<(), ProgramError> {
        let dst = dst.get_mut(..Self::LEN).ok_or(ProgramError::AccountDataTooSmall)?;
        dst[0..8].copy_from_slice(&self.amount.to_le_bytes());
        Ok(())
    }

    pub fn deserialize(src: &[u8]) -> Result<Self, ProgramError> {
        let src: &[u8; Self::LEN] =
            src.get(..Self::LEN).and_then(|s| s.try_into().ok()).ok_or(ProgramError::InvalidAccountData)?;
        Ok(Self { amount: u64::from_le_bytes(*src) })
    }
}
