use anchor_lang::prelude::*;

use spl_tlv_account_resolution::{account::ExtraAccountMeta, seeds::Seed, state::ExtraAccountMetaList};

use crate::AB_WALLET_SEED;

/// The transfer hook resolves one extra account per side of a transfer: the
/// source wallet's ab_wallet PDA and the destination wallet's ab_wallet PDA.
const NUM_EXTRA_ACCOUNTS: usize = 2;

pub fn get_meta_list_size() -> Result<usize> {
    Ok(ExtraAccountMetaList::size_of(NUM_EXTRA_ACCOUNTS).map_err(|_| ProgramError::InvalidArgument)?)
}

pub fn get_extra_account_metas() -> Result<Vec<ExtraAccountMeta>> {
    Ok(vec![
        // [5] ab_wallet for source token account wallet
        ExtraAccountMeta::new_with_seeds(
            &[
                Seed::Literal { bytes: AB_WALLET_SEED.to_vec() },
                Seed::AccountData { account_index: 0, data_index: 32, length: 32 },
            ],
            false,
            false,
        )
        .map_err(|_| ProgramError::InvalidArgument)?, // [0] source token account
        // [6] ab_wallet for destination token account wallet
        ExtraAccountMeta::new_with_seeds(
            &[
                Seed::Literal { bytes: AB_WALLET_SEED.to_vec() },
                Seed::AccountData { account_index: 2, data_index: 32, length: 32 },
            ],
            false,
            false,
        )
        .map_err(|_| ProgramError::InvalidArgument)?, // [2] destination token account
    ])
}
