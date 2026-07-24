use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use anchor_spl::{
    token_2022::spl_token_2022::{
        extension::{BaseStateWithExtensions, PodStateWithExtensions},
        pod::PodMint,
    },
    token_interface::{token_metadata_update_field, Mint, Token2022, TokenMetadataUpdateField},
};
use spl_token_metadata_interface::state::{Field, TokenMetadata};

#[derive(Accounts)]
pub struct UpdateField<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        extensions::metadata_pointer::metadata_address = mint_account,
    )]
    pub mint_account: InterfaceAccount<'info, Mint>,
    pub token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

pub fn process_update_field(ctx: Context<UpdateField>, args: UpdateFieldArgs) -> Result<()> {
    let UpdateFieldArgs { field, value } = args;

    // Convert to Field type from spl_token_metadata_interface
    let field = field.to_spl_field();
    msg!("Field: {:?}, Value: {}", field, value);

    let (current_lamports, required_lamports) = {
        // Get the current state of the mint account
        let mint = &ctx.accounts.mint_account.to_account_info();
        let buffer = mint.try_borrow_data()?;
        let state = PodStateWithExtensions::<PodMint>::unpack(&buffer)?;

        // Get and update the token metadata
        let mut token_metadata = state.get_variable_len_extension::<TokenMetadata>()?;
        token_metadata.update(field.clone(), value.clone());
        msg!("Updated TokenMetadata: {:?}", token_metadata);

        // Calculate the new account length with the updated metadata
        let new_account_len =
            state.try_get_new_account_len_for_variable_len_extension(&token_metadata)?;

        // Calculate the required lamports for the new account length
        let required_lamports = Rent::get()?.minimum_balance(new_account_len);
        // Get the current lamports of the mint account
        let current_lamports = mint.lamports();

        msg!("Required lamports: {}", required_lamports);
        msg!("Current lamports: {}", current_lamports);

        (current_lamports, required_lamports)
    };

    // Transfer lamports to mint account for the additional metadata if needed
    if required_lamports > current_lamports {
        let lamport_difference = required_lamports - current_lamports;
        transfer(
            CpiContext::new(
                ctx.accounts.system_program.key(),
                Transfer {
                    from: ctx.accounts.authority.to_account_info(),
                    to: ctx.accounts.mint_account.to_account_info(),
                },
            ),
            lamport_difference,
        )?;
        msg!(
            "Transferring {} lamports to metadata account",
            lamport_difference
        );
    }

    // Update token metadata
    token_metadata_update_field(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            TokenMetadataUpdateField {
                program_id: ctx.accounts.token_program.to_account_info(),
                metadata: ctx.accounts.mint_account.to_account_info(),
                update_authority: ctx.accounts.authority.to_account_info(),
            },
        ),
        field,
        value,
    )?;
    Ok(())
}

// Custom struct to implement AnchorSerialize and AnchorDeserialize
// This is required to pass the struct as an argument to the instruction
#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct UpdateFieldArgs {
    /// Field to update in the metadata
    pub field: AnchorField,
    /// Value to write for the field
    pub value: String,
}

// Need to do this so the enum shows up in the IDL
#[derive(AnchorSerialize, AnchorDeserialize, Debug)]
pub enum AnchorField {
    /// The name field, corresponding to `TokenMetadata.name`
    Name,
    /// The symbol field, corresponding to `TokenMetadata.symbol`
    Symbol,
    /// The uri field, corresponding to `TokenMetadata.uri`
    Uri,
    /// A custom field, whose key is given by the associated string
    Key(String),
}

// Convert AnchorField to Field from spl_token_metadata_interface
impl AnchorField {
    fn to_spl_field(&self) -> Field {
        match self {
            AnchorField::Name => Field::Name,
            AnchorField::Symbol => Field::Symbol,
            AnchorField::Uri => Field::Uri,
            AnchorField::Key(s) => Field::Key(s.clone()),
        }
    }
}
