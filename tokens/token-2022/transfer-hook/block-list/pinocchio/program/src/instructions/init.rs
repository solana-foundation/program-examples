use pinocchio::{
    cpi::Signer,
    instruction::seeds,
    sysvars::{rent::Rent, Sysvar},
    AccountView, Address, ProgramResult,
};

use crate::{load_mut_unchecked, BlockListError, Config, Discriminator, Transmutable};

pub struct Init<'a> {
    pub authority: &'a AccountView,
    pub config: &'a AccountView,
    pub system_program: &'a AccountView,
    pub config_bump: u8,
}

impl<'a> Discriminator for Init<'a> {
    const DISCRIMINATOR: u8 = 0xF1;
}

impl<'a> TryFrom<&'a [AccountView]> for Init<'a> {
    type Error = BlockListError;

    fn try_from(accounts: &'a [AccountView]) -> Result<Self, Self::Error> {
        let [authority, config, system_program] = accounts else {
            return Err(BlockListError::NotEnoughAccounts);
        };

        if !authority.is_signer() {
            return Err(BlockListError::InvalidAuthority);
        }

        /* do we really need to check this? its going to fail silently if not writable
        if !config.is_writable {
            return Err(BlockListError::InvalidInstruction);
        }*/

        // derive config account
        let (_, config_bump) = Address::find_program_address(&[Config::SEED_PREFIX], &crate::ID);
        // no need to check if address is valid
        // cpi call with config as signer, runtime will check if the right account has been signer escalated

        //if config_account.ne(config.address()) {
        //    return Err(BlockListError::InvalidConfigAccount);
        //}

        // check if system program is valid
        if system_program.address().ne(&pinocchio_system::ID) {
            return Err(BlockListError::InvalidSystemProgram);
        }

        Ok(Self { authority, config, system_program, config_bump })
    }
}

impl<'a> Init<'a> {
    pub fn process(&self) -> ProgramResult {
        let lamports = Rent::get()?.try_minimum_balance(Config::LEN)?;

        let bump_seed = [self.config_bump];
        let seeds = seeds!(Config::SEED_PREFIX, &bump_seed);
        let signer = Signer::from(&seeds);

        pinocchio_system::instructions::CreateAccount {
            from: self.authority,
            to: self.config,
            lamports,
            space: Config::LEN as u64,
            owner: &crate::ID,
        }
        .invoke_signed(&[signer])?;

        let mut config_account = *self.config;
        let mut data = config_account.try_borrow_mut()?;
        let config = unsafe { load_mut_unchecked::<Config>(&mut data)? };
        config.discriminator = Config::DISCRIMINATOR;
        config.authority = *self.authority.address();

        Ok(())
    }
}
