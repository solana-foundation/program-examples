use pinocchio::error::ProgramError;

/// Errors returned by this example, surfaced as `ProgramError::Custom`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GameError {
    /// The player does not have enough energy for this action.
    NotEnoughEnergy = 0,
    /// The signer is not the player's authority.
    WrongAuthority = 1,
    /// An account is not the PDA this program derives for it.
    InvalidSeeds = 2,
    /// An account is not owned by this program, or is the wrong size.
    InvalidAccountData = 3,
}

impl From<GameError> for ProgramError {
    fn from(error: GameError) -> Self {
        ProgramError::Custom(error as u32)
    }
}
