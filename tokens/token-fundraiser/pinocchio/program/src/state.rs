use pinocchio::error::ProgramError;

/// A fundraising campaign, stored in the fundraiser PDA.
///
/// The fundraiser PDA is derived from `[b"fundraiser", maker]` and owns the
/// vault token account that holds contributions until the campaign either hits
/// its target (the maker collects) or expires (contributors refund).
///
/// Serialized byte layout (little-endian), matching the field order below:
/// `[maker: 32][mint_to_raise: 32][amount_to_raise: u64][current_amount: u64]
///  [time_started: i64][duration: u16][bump: u8]`
pub struct Fundraiser {
    /// The wallet that opened the campaign and collects a successful raise.
    pub maker: [u8; 32],
    /// Mint contributions must be denominated in.
    pub mint_to_raise: [u8; 32],
    /// Target, in base units of `mint_to_raise`.
    pub amount_to_raise: u64,
    /// Running total contributed so far, in base units.
    pub current_amount: u64,
    /// Unix timestamp the campaign opened at.
    pub time_started: i64,
    /// Campaign length in days, counted from `time_started`.
    pub duration: u16,
    /// Canonical bump for the fundraiser PDA.
    pub bump: u8,
}

impl Fundraiser {
    /// Seed prefix for the fundraiser PDA: `[SEED_PREFIX, maker]`.
    pub const SEED_PREFIX: &'static [u8] = b"fundraiser";

    /// Serialized size of a `Fundraiser` in bytes.
    pub const LEN: usize = 32 + 32 + 8 + 8 + 8 + 2 + 1;

    /// Writes the fundraiser into `dst` using the layout documented above.
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

    /// Reads a fundraiser from `src`, which must be at least [`Fundraiser::LEN`] bytes.
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

/// Per-contributor running total, stored in the contributor PDA derived from
/// `[b"contributor", fundraiser, contributor]`.
///
/// Tracking each contributor separately is what makes the per-contributor cap
/// enforceable and lets an expired campaign refund exactly what each wallet put
/// in.
///
/// Serialized byte layout: `[amount: u64]`.
pub struct Contributor {
    /// Total contributed by this wallet, in base units of the campaign mint.
    pub amount: u64,
}

impl Contributor {
    /// Seed prefix for the contributor PDA: `[SEED_PREFIX, fundraiser, contributor]`.
    pub const SEED_PREFIX: &'static [u8] = b"contributor";

    /// Serialized size of a `Contributor` in bytes.
    pub const LEN: usize = 8;

    /// Writes the contributor total into `dst`.
    pub fn serialize(&self, dst: &mut [u8]) -> Result<(), ProgramError> {
        let dst = dst.get_mut(..Self::LEN).ok_or(ProgramError::AccountDataTooSmall)?;
        dst[0..8].copy_from_slice(&self.amount.to_le_bytes());
        Ok(())
    }

    /// Reads a contributor total from `src`.
    pub fn deserialize(src: &[u8]) -> Result<Self, ProgramError> {
        let src: &[u8; Self::LEN] =
            src.get(..Self::LEN).and_then(|s| s.try_into().ok()).ok_or(ProgramError::InvalidAccountData)?;
        Ok(Self { amount: u64::from_le_bytes(*src) })
    }
}
