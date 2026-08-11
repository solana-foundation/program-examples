use {
    crate::{error::*, state::*, utils::*},
    borsh::{BorshDeserialize, BorshSerialize},
    solana_program::{
        account_info::AccountInfo,
        entrypoint::ProgramResult,
        program::{invoke, invoke_signed},
        program_error::ProgramError,
        program_pack::Pack,
        pubkey::Pubkey,
    },
    spl_associated_token_account_interface::instruction as associated_token_account_instruction,
    spl_token_interface::{instruction as token_instruction, state::Account as TokenAccount},
};

#[derive(BorshDeserialize, BorshSerialize, Debug)]
pub struct TakeOffer {}

impl TakeOffer {
    pub fn process(program_id: &Pubkey, accounts: &[AccountInfo<'_>]) -> ProgramResult {
        // accounts in order
        //
        let [
            offer_info, // offer account info
            token_mint_a, // token mint A
            token_mint_b, // token mint b
            maker_token_account_b, // maker token a account
            taker_token_account_a, // mkaer token b account
            taker_token_account_b, // taker token a account
            vault, // vault
            maker, // maker
            taker, // taker
            payer, // payer
            token_program, // token program
            associated_token_program, // associated token program
            system_program// system program
        ] = accounts else {
            return Err(ProgramError::NotEnoughAccountKeys);
        };

        // ensure the taker signs the instruction
        //
        if !taker.is_signer {
            return Err(ProgramError::MissingRequiredSignature);
        }

        // get the offer data
        //
        let offer = Offer::try_from_slice(&offer_info.data.borrow()[..])?;

        // validate the offer
        //
        assert_eq!(&offer.maker, maker.key);
        assert_eq!(&offer.token_mint_a, token_mint_a.key);
        assert_eq!(&offer.token_mint_b, token_mint_b.key);

        // validate the offer accout with signer seeds
        let offer_signer_seeds = &[Offer::SEED_PREFIX, maker.key.as_ref(), &offer.id.to_le_bytes(), &[offer.bump]];

        let offer_key = Pubkey::create_program_address(offer_signer_seeds, program_id)?;

        // make sure the offer key is the same
        //
        if *offer_info.key != offer_key {
            return Err(EscrowError::OfferKeyMismatch.into());
        };

        // validate receiving addresses
        //
        assert_is_associated_token_account(maker_token_account_b.key, maker.key, token_mint_b.key)?;
        assert_is_associated_token_account(taker_token_account_a.key, taker.key, token_mint_a.key)?;

        // validate the vault is the offer's actual vault, not a substitute
        // token-A account that also happens to be owned by the offer PDA
        //
        assert_is_associated_token_account(vault.key, offer_info.key, token_mint_a.key)?;

        // create taker token A account if needed, before receiveing tokens
        //
        if taker_token_account_a.lamports() == 0 {
            // create the vault token account
            invoke(
                &associated_token_account_instruction::create_associated_token_account(
                    payer.key,
                    taker.key,
                    token_mint_a.key,
                    token_program.key,
                ),
                &[
                    token_mint_a.clone(),
                    taker_token_account_a.clone(),
                    taker.clone(),
                    payer.clone(),
                    system_program.clone(),
                    token_program.clone(),
                    associated_token_program.clone(),
                ],
            )?;
        }

        // create maker token B account if needed, before receiveing tokens
        //
        if maker_token_account_b.lamports() == 0 {
            // create the vault token account
            invoke(
                &associated_token_account_instruction::create_associated_token_account(
                    payer.key,
                    maker.key,
                    token_mint_b.key,
                    token_program.key,
                ),
                &[
                    token_mint_b.clone(),
                    maker_token_account_b.clone(),
                    maker.clone(),
                    payer.clone(),
                    system_program.clone(),
                    token_program.clone(),
                    associated_token_program.clone(),
                ],
            )?;
        }

        // read token accounts
        //
        let vault_amount_a = TokenAccount::unpack(&vault.data.borrow())?.amount;
        let taker_amount_a_before_transfer = TokenAccount::unpack(&taker_token_account_a.data.borrow())?.amount;
        let maker_amount_b_before_transfer = TokenAccount::unpack(&maker_token_account_b.data.borrow())?.amount;
        let taker_amount_b = TokenAccount::unpack(&taker_token_account_b.data.borrow())?.amount;

        solana_program::msg!("Vault A Balance Before Transfer: {}", vault_amount_a);
        solana_program::msg!("Taker A Balance Before Transfer: {}", taker_amount_a_before_transfer);
        solana_program::msg!("Maker B Balance Before Transfer: {}", maker_amount_b_before_transfer);
        solana_program::msg!("Taker B Balance Before Transfer: {}", taker_amount_b);

        // taker transfer mint a tokens to vault
        //
        invoke(
            &token_instruction::transfer(
                token_program.key,
                taker_token_account_b.key,
                maker_token_account_b.key,
                taker.key,
                &[taker.key],
                offer.token_b_wanted_amount,
            )?,
            &[token_program.clone(), taker_token_account_b.clone(), maker_token_account_b.clone(), taker.clone()],
        )?;

        // transfer from vault to taker
        //
        invoke_signed(
            &token_instruction::transfer(
                token_program.key,
                vault.key,
                taker_token_account_a.key,
                offer_info.key,
                &[offer_info.key, taker.key],
                vault_amount_a,
            )?,
            &[
                token_mint_a.clone(),
                vault.clone(),
                taker_token_account_a.clone(),
                offer_info.clone(),
                taker.clone(),
                token_program.clone(),
            ],
            &[offer_signer_seeds],
        )?;

        let taker_amount_a = TokenAccount::unpack(&taker_token_account_a.data.borrow())?.amount;
        let maker_amount_b = TokenAccount::unpack(&maker_token_account_b.data.borrow())?.amount;

        assert_eq!(taker_amount_a, taker_amount_a_before_transfer + vault_amount_a);
        assert_eq!(maker_amount_b, maker_amount_b_before_transfer + offer.token_b_wanted_amount);

        let taker_amount_b = TokenAccount::unpack(&taker_token_account_b.data.borrow())?.amount;
        let vault_amount_a = TokenAccount::unpack(&vault.data.borrow())?.amount;

        solana_program::msg!("Vault A Balance After Transfer: {}", vault_amount_a);
        solana_program::msg!("Taker A Balance After Transfer: {}", taker_amount_a);
        solana_program::msg!("Maker B Balance After Transfer: {}", maker_amount_b);
        solana_program::msg!("Taker B Balance After Transfer: {}", taker_amount_b);

        // close the vault account
        //
        invoke_signed(
            &spl_token_interface::instruction::close_account(
                token_program.key,
                vault.key,
                taker.key,
                offer_info.key,
                &[],
            )?,
            &[vault.clone(), taker.clone(), offer_info.clone()],
            &[offer_signer_seeds],
        )?;

        // Send the rent back to the payer
        //
        let lamports = offer_info.lamports();
        **offer_info.lamports.borrow_mut() -= lamports;
        **payer.lamports.borrow_mut() += lamports;

        // Realloc the account to zero
        //
        offer_info.resize(0)?;

        // Assign the account to the System Program
        //
        offer_info.assign(system_program.key);

        Ok(())
    }
}
