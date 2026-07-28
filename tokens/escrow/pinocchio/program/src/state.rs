use pinocchio::error::ProgramError;

/// Persistent record of an open escrow offer, stored in the offer PDA.
///
/// The offer PDA is derived from `[b"offer", maker, id]` and owns the vault
/// token account that holds the maker's deposited tokens until the offer is
/// taken.
///
/// Serialized byte layout (little-endian), matching the field order below so
/// that a Borsh client can deserialize it directly:
/// `[id: u64][maker: 32][token_mint_a: 32][token_mint_b: 32]
///  [token_b_wanted_amount: u64][bump: u8]`
pub struct Offer {
    /// Maker-chosen identifier; part of the offer PDA seeds so a single maker
    /// can have many concurrent offers.
    pub id: u64,
    /// The wallet that created the offer.
    pub maker: [u8; 32],
    /// Mint of the token deposited into the vault.
    pub token_mint_a: [u8; 32],
    /// Mint of the token the maker wants in return.
    pub token_mint_b: [u8; 32],
    /// Amount of token B the maker wants in exchange for the vaulted token A.
    pub token_b_wanted_amount: u64,
    /// Canonical bump for the offer PDA.
    pub bump: u8,
}

impl Offer {
    /// Seed prefix for the offer PDA: `[SEED_PREFIX, maker, id]`.
    pub const SEED_PREFIX: &'static [u8] = b"offer";

    /// Serialized size of an `Offer` in bytes.
    pub const LEN: usize = 8 + 32 + 32 + 32 + 8 + 1;

    /// Writes the offer into `dst` using the layout documented above.
    pub fn serialize(&self, dst: &mut [u8]) -> Result<(), ProgramError> {
        let dst = dst.get_mut(..Self::LEN).ok_or(ProgramError::AccountDataTooSmall)?;
        dst[0..8].copy_from_slice(&self.id.to_le_bytes());
        dst[8..40].copy_from_slice(&self.maker);
        dst[40..72].copy_from_slice(&self.token_mint_a);
        dst[72..104].copy_from_slice(&self.token_mint_b);
        dst[104..112].copy_from_slice(&self.token_b_wanted_amount.to_le_bytes());
        dst[112] = self.bump;
        Ok(())
    }

    /// Reads an offer from `src`, which must be at least [`Offer::LEN`] bytes.
    pub fn deserialize(src: &[u8]) -> Result<Self, ProgramError> {
        let src: &[u8; Self::LEN] =
            src.get(..Self::LEN).and_then(|s| s.try_into().ok()).ok_or(ProgramError::InvalidAccountData)?;
        Ok(Self {
            id: u64::from_le_bytes(src[0..8].try_into().unwrap()),
            maker: src[8..40].try_into().unwrap(),
            token_mint_a: src[40..72].try_into().unwrap(),
            token_mint_b: src[72..104].try_into().unwrap(),
            token_b_wanted_amount: u64::from_le_bytes(src[104..112].try_into().unwrap()),
            bump: src[112],
        })
    }
}
