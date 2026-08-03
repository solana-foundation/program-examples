use pinocchio::Resize;
use pinocchio::{
    cpi::Signer,
    instruction::seeds,
    sysvars::{rent::Rent, Sysvar},
    AccountView, Address, ProgramResult,
};

use crate::{
    load,
    token2022_utils::{get_transfer_hook_authority, is_token_2022_mint, EXTRA_METAS_SEED},
    BlockListError, Config, Discriminator,
};

pub struct SetupExtraMetas<'a> {
    pub authority: &'a AccountView,
    pub config: &'a AccountView,
    pub mint: &'a AccountView,
    pub extra_metas: &'a AccountView,
    pub system_program: &'a AccountView,
    pub extra_metas_bump: u8,
}

impl<'a> Discriminator for SetupExtraMetas<'a> {
    const DISCRIMINATOR: u8 = 0x6A;
}

impl<'a> TryFrom<&'a [AccountView]> for SetupExtraMetas<'a> {
    type Error = BlockListError;

    fn try_from(accounts: &'a [AccountView]) -> Result<Self, Self::Error> {
        let [authority, config, mint, extra_metas, system_program] = accounts else {
            return Err(BlockListError::NotEnoughAccounts);
        };

        if !authority.is_signer() {
            return Err(BlockListError::InvalidAuthority);
        }

        if !is_token_2022_mint(mint) {
            return Err(BlockListError::InvalidMint);
        }

        let transfer_hook_authority = get_transfer_hook_authority(unsafe { mint.borrow_unchecked() });
        if transfer_hook_authority.is_none() || !transfer_hook_authority.unwrap().eq(authority.address()) {
            return Err(BlockListError::InvalidAuthority);
        }

        // derive extra_metas account
        let (extra_metas_address, extra_metas_bump) =
            Address::find_program_address(&[EXTRA_METAS_SEED, mint.address().as_ref()], &crate::ID);

        if extra_metas_address.ne(extra_metas.address()) {
            return Err(BlockListError::InvalidExtraMetasAccount);
        }

        // check if system program is valid
        if system_program.address().ne(&pinocchio_system::ID) {
            return Err(BlockListError::InvalidSystemProgram);
        }

        Ok(Self { authority, config, mint, extra_metas, system_program, extra_metas_bump })
    }
}

impl<'a> SetupExtraMetas<'a> {
    pub fn process(&self, remaining_data: &[u8]) -> ProgramResult {
        let config = unsafe { load::<Config>(&self.config.borrow_unchecked())? };

        let data = if config.blocked_wallets_count == 0 {
            EXTRA_METAS_EMPTY_DEPENDENCIES
        } else if remaining_data.len() == 1 && remaining_data[0] == 1 {
            EXTRA_METAS_BOTH_DEPENDENCIES
        } else {
            EXTRA_METAS_SOURCE_DEPENDENCY
        };

        let min_lamports = Rent::get()?.try_minimum_balance(data.len())?;

        if self.extra_metas.owned_by(&crate::ID) {
            let current_lamports = self.extra_metas.lamports();
            let auth_lamports = self.authority.lamports();

            // just resize
            let mut extra_metas_account = *self.extra_metas;
            extra_metas_account.resize(data.len())?;

            if current_lamports < min_lamports {
                // transfer to extra
                let diff = min_lamports - current_lamports;
                pinocchio_system::instructions::Transfer { from: self.authority, to: self.extra_metas, lamports: diff }
                    .invoke()?;
            } else if current_lamports > min_lamports {
                // transfer from extra
                let diff = current_lamports - min_lamports;
                let mut extra_metas_account = *self.extra_metas;
                let mut authority_account = *self.authority;
                extra_metas_account.set_lamports(min_lamports);
                authority_account.set_lamports(auth_lamports.checked_add(diff).unwrap());
            }
        } else {
            // create new account

            let bump_seed = [self.extra_metas_bump];
            let seeds = seeds!(EXTRA_METAS_SEED, self.mint.address().as_ref(), &bump_seed);
            let signer = Signer::from(&seeds);

            pinocchio_system::instructions::CreateAccount {
                from: self.authority,
                to: self.extra_metas,
                lamports: min_lamports,
                space: data.len() as u64,
                owner: &crate::ID,
            }
            .invoke_signed(&[signer])?;
        }

        // overwrite state depending on config

        let mut extra_metas_account = *self.extra_metas;
        let extra_metas_data = unsafe { extra_metas_account.borrow_unchecked_mut() };
        extra_metas_data[..data.len()].copy_from_slice(data);

        Ok(())
    }
}

/// HOW TO GET THESE MAGIC VALUES
/// run the CLI using `block-list-cli get-extra-metas-account-data`
/// it will generate the 3 arrays without needing to add more dependencies (bloat) to the program
pub const EXTRA_METAS_EMPTY_DEPENDENCIES: &[u8] = &[105, 37, 101, 197, 75, 251, 102, 26, 4, 0, 0, 0, 0, 0, 0, 0];
pub const EXTRA_METAS_SOURCE_DEPENDENCY: &[u8] = &[
    105, 37, 101, 197, 75, 251, 102, 26, 39, 0, 0, 0, 1, 0, 0, 0, 1, 1, 12, 119, 97, 108, 108, 101, 116, 95, 98, 108,
    111, 99, 107, 4, 0, 32, 32, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
];
pub const EXTRA_METAS_BOTH_DEPENDENCIES: &[u8] = &[
    105, 37, 101, 197, 75, 251, 102, 26, 74, 0, 0, 0, 2, 0, 0, 0, 1, 1, 12, 119, 97, 108, 108, 101, 116, 95, 98, 108,
    111, 99, 107, 4, 0, 32, 32, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 12, 119, 97, 108, 108, 101, 116,
    95, 98, 108, 111, 99, 107, 4, 2, 32, 32, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
];
