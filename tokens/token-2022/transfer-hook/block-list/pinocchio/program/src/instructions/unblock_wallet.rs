use pinocchio::{error::ProgramError, AccountView, ProgramResult};

use crate::{load, load_mut_unchecked, BlockListError, Config, Discriminator, WalletBlock};

pub struct UnblockWallet<'a> {
    pub authority: &'a AccountView,
    pub config: &'a AccountView,
    pub wallet_block: &'a AccountView,
    pub system_program: &'a AccountView,
}

impl<'a> UnblockWallet<'a> {
    pub fn process(&self) -> ProgramResult {
        let destination_lamports = self.authority.lamports();

        let mut authority = *self.authority;
        let mut wallet_block = *self.wallet_block;
        authority.set_lamports(
            destination_lamports.checked_add(self.wallet_block.lamports()).ok_or(ProgramError::ArithmeticOverflow)?,
        );
        unsafe {
            wallet_block.close_unchecked();
        }

        let mut config_account = *self.config;
        let config = unsafe { load_mut_unchecked::<Config>(config_account.borrow_unchecked_mut())? };
        config.blocked_wallets_count =
            config.blocked_wallets_count.checked_sub(1).ok_or(ProgramError::ArithmeticOverflow)?;

        Ok(())
    }
}

impl<'a> Discriminator for UnblockWallet<'a> {
    const DISCRIMINATOR: u8 = 0xF3;
}

impl<'a> TryFrom<&'a [AccountView]> for UnblockWallet<'a> {
    type Error = BlockListError;

    fn try_from(accounts: &'a [AccountView]) -> Result<Self, Self::Error> {
        let [authority, config, wallet_block, system_program] = accounts else {
            return Err(BlockListError::NotEnoughAccounts);
        };

        let cfg = unsafe { load::<Config>(config.borrow_unchecked())? };

        if !config.owned_by(&crate::ID) {
            return Err(BlockListError::InvalidConfigAccount);
        }

        if !authority.is_signer() || cfg.authority.ne(authority.address()) {
            return Err(BlockListError::InvalidAuthority);
        }

        if !config.is_writable() && !wallet_block.is_writable() {
            return Err(BlockListError::AccountNotWritable);
        }

        if unsafe { load::<WalletBlock>(wallet_block.borrow_unchecked()).is_err() } {
            return Err(BlockListError::InvalidAccountData);
        }

        Ok(Self { authority, config, wallet_block, system_program })
    }
}
