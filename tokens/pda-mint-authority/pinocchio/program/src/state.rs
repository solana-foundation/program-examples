use pinocchio::{error::ProgramError, Address};

/// Persistent record stored in the mint-authority PDA.
///
/// The PDA is derived from `[b"mint_authority"]` and acts as the mint and
/// freeze authority for every token this program creates. Persisting the
/// canonical bump lets later instructions rebuild the signer seeds without
/// re-deriving the address on-chain.
pub struct MintAuthorityPda {
    /// Canonical bump for the mint-authority PDA.
    pub bump: u8,
}

impl MintAuthorityPda {
    /// Seed for the mint-authority PDA: `[SEED_PREFIX]`.
    pub const SEED_PREFIX: &'static [u8] = b"mint_authority";

    /// Bytes allocated for the account. Mirrors the `native` example (8 + 8);
    /// only the first byte (the bump) is meaningful.
    pub const ACCOUNT_SPACE: usize = 16;

    /// Writes the bump into the first byte of `dst`.
    pub fn serialize(&self, dst: &mut [u8]) -> Result<(), ProgramError> {
        *dst.first_mut().ok_or(ProgramError::AccountDataTooSmall)? = self.bump;
        Ok(())
    }

    /// Reads the bump from the first byte of `src`.
    pub fn deserialize(src: &[u8]) -> Result<Self, ProgramError> {
        let bump = *src.first().ok_or(ProgramError::InvalidAccountData)?;
        Ok(Self { bump })
    }
}

/// Persistent record stored in the mint-config PDA.
///
/// The PDA is derived from `[b"mint_config", mint]`, created alongside each
/// token and bound to its mint, recording the wallet that created it. The
/// mint-authority PDA signs unconditionally for whoever calls `mint_to`, so
/// this account is the only thing restricting minting to that wallet.
pub struct MintConfig {
    /// Wallet recorded at token creation; the only caller allowed to mint.
    pub admin: Address,
}

impl MintConfig {
    /// First seed for the mint-config PDA: `[SEED_PREFIX, mint]`.
    pub const SEED_PREFIX: &'static [u8] = b"mint_config";

    /// Bytes allocated for the account: the admin address.
    pub const ACCOUNT_SPACE: usize = 32;

    /// Writes the admin into the first 32 bytes of `dst`.
    pub fn serialize(&self, dst: &mut [u8]) -> Result<(), ProgramError> {
        dst.get_mut(..32).ok_or(ProgramError::AccountDataTooSmall)?.copy_from_slice(self.admin.as_array());
        Ok(())
    }

    /// Reads the admin from the first 32 bytes of `src`.
    pub fn deserialize(src: &[u8]) -> Result<Self, ProgramError> {
        let bytes: [u8; 32] = src
            .get(..32)
            .ok_or(ProgramError::InvalidAccountData)?
            .try_into()
            .map_err(|_| ProgramError::InvalidAccountData)?;
        Ok(Self { admin: Address::new_from_array(bytes) })
    }
}
