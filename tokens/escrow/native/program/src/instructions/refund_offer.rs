use {
    crate::{error::*, state::*, utils::*},
    borsh::BorshDeserialize,
    solana_program::{
        account_info::AccountInfo, entrypoint::ProgramResult, program::invoke_signed, program_error::ProgramError,
        program_pack::Pack, pubkey::Pubkey,
    },
    spl_token_interface::{instruction as token_instruction, state::Account as TokenAccount},
};

#[derive(BorshDeserialize, Debug)]
pub struct RefundOffer {}

impl RefundOffer {
    pub fn process(program_id: &Pubkey, accounts: &[AccountInfo<'_>]) -> ProgramResult {
        // accounts in order
        //
        let [
            offer_info, // offer account info
            token_mint_a, // token mint a
            maker_token_account_a, // maker token a account, receives the refund
            vault, // vault
            maker, // maker
            token_program, // token program
            system_program// system program
        ] = accounts else {
            return Err(ProgramError::NotEnoughAccountKeys);
        };

        // ensure the maker signs the instruction
        //
        if !maker.is_signer {
            return Err(ProgramError::MissingRequiredSignature);
        }

        // ensure the caller didn't substitute a fake token program - the real
        // program is what actually enforces the transfer/close below
        //
        spl_token_interface::check_program_account(token_program.key)?;

        // get the offer data
        //
        let offer = Offer::try_from_slice(&offer_info.data.borrow()[..])?;

        // only the maker who created the offer may refund it
        //
        assert_eq!(&offer.maker, maker.key);
        assert_eq!(&offer.token_mint_a, token_mint_a.key);

        // validate the offer account with signer seeds
        //
        let offer_signer_seeds = &[Offer::SEED_PREFIX, maker.key.as_ref(), &offer.id.to_le_bytes(), &[offer.bump]];

        let offer_key = Pubkey::create_program_address(offer_signer_seeds, program_id)?;

        // make sure the offer key is the same
        //
        if *offer_info.key != offer_key {
            return Err(EscrowError::OfferKeyMismatch.into());
        };

        // validate the maker's receiving address
        //
        assert_is_associated_token_account(maker_token_account_a.key, maker.key, token_mint_a.key)?;

        // validate the vault is the offer's actual vault, not a substitute
        // token-A account that also happens to be owned by the offer PDA
        //
        assert_is_associated_token_account(vault.key, offer_info.key, token_mint_a.key)?;

        // return the vaulted tokens to the maker
        //
        let vault_amount_a = TokenAccount::unpack(&vault.data.borrow())?.amount;

        invoke_signed(
            &token_instruction::transfer(
                token_program.key,
                vault.key,
                maker_token_account_a.key,
                offer_info.key,
                &[offer_info.key],
                vault_amount_a,
            )?,
            &[vault.clone(), maker_token_account_a.clone(), offer_info.clone(), token_program.clone()],
            &[offer_signer_seeds],
        )?;

        // close the vault account, rent to the maker
        //
        invoke_signed(
            &spl_token_interface::instruction::close_account(
                token_program.key,
                vault.key,
                maker.key,
                offer_info.key,
                &[],
            )?,
            &[vault.clone(), maker.clone(), offer_info.clone()],
            &[offer_signer_seeds],
        )?;

        // Send the rent back to the maker
        //
        let lamports = offer_info.lamports();
        **offer_info.lamports.borrow_mut() -= lamports;
        **maker.lamports.borrow_mut() += lamports;

        // Realloc the account to zero
        //
        offer_info.resize(0)?;

        // Assign the account to the System Program
        //
        offer_info.assign(system_program.key);

        Ok(())
    }
}
