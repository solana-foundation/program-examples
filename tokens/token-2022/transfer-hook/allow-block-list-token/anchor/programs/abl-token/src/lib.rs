use anchor_lang::prelude::*;
use spl_discriminator::SplDiscriminate;
use spl_transfer_hook_interface::instruction::ExecuteInstruction;

pub mod constants;
pub mod errors;
pub mod instructions;
pub mod state;
pub mod utils;
pub use constants::*;
pub use errors::*;
pub use instructions::*;
pub use state::*;
pub use utils::*;

declare_id!("3ku1ZEGvBEEfhaYsAzBZuecTPEa58ZRhoVqHVGpGxVGi");

#[program]
pub mod abl_token {

    use super::*;

    pub fn init_mint(ctx: Context<InitMint>, args: InitMintArgs) -> Result<()> {
        ctx.accounts.init_mint(args)
    }

    pub fn init_config(ctx: Context<InitConfig>) -> Result<()> {
        ctx.accounts.init_config(ctx.bumps.config)
    }

    pub fn attach_to_mint(ctx: Context<AttachToMint>) -> Result<()> {
        ctx.accounts.attach_to_mint()
    }

    #[instruction(discriminator = ExecuteInstruction::SPL_DISCRIMINATOR_SLICE)]
    pub fn tx_hook(ctx: Context<TxHook>, amount: u64) -> Result<()> {
        ctx.accounts.tx_hook(amount)
    }

    pub fn init_wallet(ctx: Context<InitWallet>, args: InitWalletArgs) -> Result<()> {
        ctx.accounts.init_wallet(args)
    }

    pub fn remove_wallet(ctx: Context<RemoveWallet>) -> Result<()> {
        ctx.accounts.remove_wallet()
    }

    pub fn change_mode(ctx: Context<ChangeMode>, args: ChangeModeArgs) -> Result<()> {
        ctx.accounts.change_mode(args)
    }

    pub fn resize_meta_list(ctx: Context<ResizeMetaList>) -> Result<()> {
        ctx.accounts.resize_meta_list()
    }
}
