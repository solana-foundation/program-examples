use pinocchio::{
    cpi::Signer,
    error::ProgramError,
    instruction::seeds,
    sysvars::{rent::Rent, Sysvar},
    AccountView, Address, ProgramResult,
};

use crate::{load, load_mut_unchecked, BlockListError, Config, Discriminator, Transmutable, WalletBlock};

pub struct BlockWallet<'a> {
    pub authority: &'a AccountView,
    pub config: &'a AccountView,
    pub wallet: &'a AccountView,
    pub wallet_block: &'a AccountView,
    pub system_program: &'a AccountView,
    pub wallet_block_bump: u8,
}

impl<'a> BlockWallet<'a> {
    pub fn process(&self) -> ProgramResult {
        let lamports = Rent::get()?.try_minimum_balance(WalletBlock::LEN)?;

        let bump_seed = [self.wallet_block_bump];
        let seeds = seeds!(WalletBlock::SEED_PREFIX, self.wallet.address().as_ref(), &bump_seed);
        let signer = Signer::from(&seeds);

        pinocchio_system::instructions::CreateAccount {
            from: self.authority,
            to: self.wallet_block,
            lamports,
            space: WalletBlock::LEN as u64,
            owner: &crate::ID,
        }
        .invoke_signed(&[signer])?;

        let mut wallet_block_account = *self.wallet_block;
        let mut data = wallet_block_account.try_borrow_mut()?;
        let wallet_block = unsafe { load_mut_unchecked::<WalletBlock>(&mut data)? };
        wallet_block.discriminator = WalletBlock::DISCRIMINATOR;
        wallet_block.address = *self.wallet.address();

        let mut config_account = *self.config;
        let config = unsafe { load_mut_unchecked::<Config>(config_account.borrow_unchecked_mut())? };
        config.blocked_wallets_count =
            config.blocked_wallets_count.checked_add(1).ok_or(ProgramError::ArithmeticOverflow)?;

        Ok(())
    }
}

impl<'a> Discriminator for BlockWallet<'a> {
    const DISCRIMINATOR: u8 = 0xF2;
}

impl<'a> TryFrom<&'a [AccountView]> for BlockWallet<'a> {
    type Error = BlockListError;

    fn try_from(accounts: &'a [AccountView]) -> Result<Self, Self::Error> {
        let [authority, config, wallet, wallet_block, system_program] = accounts else {
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

        let (_, wallet_block_bump) =
            Address::find_program_address(&[WalletBlock::SEED_PREFIX, wallet.address().as_ref()], &crate::ID);

        // check if system program is valid
        if system_program.address().ne(&pinocchio_system::ID) {
            return Err(BlockListError::InvalidSystemProgram);
        }

        Ok(Self { authority, config, wallet, wallet_block, system_program, wallet_block_bump })
    }
}
