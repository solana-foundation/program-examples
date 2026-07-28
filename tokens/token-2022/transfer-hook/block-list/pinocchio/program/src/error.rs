use pinocchio::error::ProgramError;

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum BlockListError {
    InvalidInstruction,

    InvalidAuthority,
    AccountBlocked,
    NotEnoughAccounts,
    InvalidAccountData,
    UninitializedAccount,
    InvalidSystemProgram,
    InvalidConfigAccount,
    AccountNotWritable,
    InvalidMint,
    InvalidExtraMetasAccount,
    ImmutableOwnerExtensionMissing,
}

impl From<BlockListError> for ProgramError {
    fn from(e: BlockListError) -> Self {
        ProgramError::Custom(e as u32)
    }
}
