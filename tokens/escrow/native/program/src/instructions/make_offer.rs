use {
    crate::{error::*, state::*, utils::assert_is_associated_token_account},
    borsh::{BorshDeserialize, BorshSerialize},
    solana_program::{
        account_info::AccountInfo,
        entrypoint::ProgramResult,
        program::{invoke, invoke_signed},
        program_error::ProgramError,
        program_pack::Pack,
        pubkey::Pubkey,
        rent::Rent,
        sysvar::Sysvar,
    },
    solana_system_interface::instruction as system_instruction,
    spl_associated_token_account_interface::instruction as associated_token_account_instruction,
    spl_token_interface::{instruction as token_instruction, state::Account as TokenAccount},
};

#[derive(BorshDeserialize, BorshSerialize, Debug)]
pub struct MakeOffer {
    pub id: u64,
    pub token_a_offered_amount: u64,
    pub token_b_wanted_amount: u64,
}

impl MakeOffer {
    pub fn process(program_id: &Pubkey, accounts: &[AccountInfo<'_>], args: MakeOffer) -> ProgramResult {
        // accounts in order.
        //
        let [
            offer_info, // offer account info
            token_mint_a, // token_mint a
            token_mint_b, // token mint b
            maker_token_account_a, // maker token account a
            vault, // vault
            maker, // maker
            payer, // payer
            token_program, // token program
            associated_token_program, // associated token program
            system_program// system program
        ] = accounts else {
            return Err(ProgramError::NotEnoughAccountKeys);
        };

        // ensure the maker signs the instruction
        //
        if !maker.is_signer {
            return Err(ProgramError::MissingRequiredSignature);
        }

        let offer_seeds = &[Offer::SEED_PREFIX, maker.key.as_ref(), &args.id.to_le_bytes()];

        let (offer_key, bump) = Pubkey::find_program_address(offer_seeds, program_id);

        // make sure the offer key is the same
        //
        if *offer_info.key != offer_key {
            return Err(EscrowError::OfferKeyMismatch.into());
        };

        // check vault is owned by the offer account
        //
        assert_is_associated_token_account(vault.key, offer_info.key, token_mint_a.key)?;

        let offer = Offer {
            bump,
            maker: *maker.key,
            id: args.id,
            token_b_wanted_amount: args.token_b_wanted_amount,
            token_mint_a: *token_mint_a.key,
            token_mint_b: *token_mint_b.key,
        };

        let size = borsh::to_vec::<Offer>(&offer)?.len();
        let lamports_required = (Rent::get()?).minimum_balance(size);

        // create account
        //
        invoke_signed(
            &system_instruction::create_account(payer.key, offer_info.key, lamports_required, size as u64, program_id),
            &[payer.clone(), offer_info.clone(), system_program.clone()],
            &[&[Offer::SEED_PREFIX, maker.key.as_ref(), args.id.to_le_bytes().as_ref(), &[bump]]],
        )?;

        // create the vault token account
        //
        invoke(
            &associated_token_account_instruction::create_associated_token_account(
                payer.key,
                offer_info.key,
                token_mint_a.key,
                token_program.key,
            ),
            &[
                token_mint_a.clone(),
                vault.clone(),
                offer_info.clone(),
                payer.clone(),
                system_program.clone(),
                token_program.clone(),
                associated_token_program.clone(),
            ],
        )?;

        // transfer Mint A tokens to vault
        //
        invoke(
            &token_instruction::transfer(
                token_program.key,
                maker_token_account_a.key,
                vault.key,
                maker.key,
                &[maker.key],
                args.token_a_offered_amount,
            )?,
            &[token_program.clone(), maker_token_account_a.clone(), vault.clone(), maker.clone()],
        )?;

        let vault_token_amount = TokenAccount::unpack(&vault.data.borrow())?.amount;

        solana_program::msg!("Amount in vault: {}", vault_token_amount);

        assert_eq!(vault_token_amount, args.token_a_offered_amount);

        // write data into offer account
        //
        offer.serialize(&mut *offer_info.data.borrow_mut())?;

        Ok(())
    }
}
