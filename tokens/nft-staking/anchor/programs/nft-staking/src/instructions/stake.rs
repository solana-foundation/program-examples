use anchor_lang::prelude::*;
use anchor_spl::{
    metadata::{freeze_delegated_account, FreezeDelegatedAccount, MasterEditionAccount, Metadata, MetadataAccount},
    token::{approve, Approve, Mint, Token, TokenAccount},
};

use crate::{NftStaked, StakeAccount, StakeConfig, StakeError, UserAccount, ANCHOR_DISCRIMINATOR};

#[derive(Accounts)]
pub struct Stake<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    pub nft_mint: Account<'info, Mint>,

    /// The NFT stays here, in the owner's own token account, for the whole
    /// stake. The program never takes custody of it — it takes *delegate
    /// authority* over this account and freezes it in place, so the NFT is
    /// immobilised while remaining visible in the owner's wallet.
    #[account(
        mut,
        associated_token::mint = nft_mint,
        associated_token::authority = user,
    )]
    pub nft_token_account: Account<'info, TokenAccount>,

    #[account(
        seeds = [b"metadata", metadata_program.key().as_ref(), nft_mint.key().as_ref()],
        seeds::program = metadata_program.key(),
        bump,
    )]
    pub metadata: Account<'info, MetadataAccount>,

    /// Required by Metaplex to freeze: the master edition PDA is the NFT
    /// mint's freeze authority, and Token Metadata signs as it on our behalf.
    #[account(
        seeds = [b"metadata", metadata_program.key().as_ref(), nft_mint.key().as_ref(), b"edition"],
        seeds::program = metadata_program.key(),
        bump,
    )]
    pub edition: Account<'info, MasterEditionAccount>,

    #[account(
        seeds = [b"config", config.admin.as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, StakeConfig>,

    #[account(
        init,
        payer = user,
        space = ANCHOR_DISCRIMINATOR + StakeAccount::INIT_SPACE,
        seeds = [b"stake", nft_mint.key().as_ref(), config.key().as_ref()],
        bump,
    )]
    pub stake_account: Account<'info, StakeAccount>,

    #[account(
        mut,
        seeds = [b"user", config.key().as_ref(), user.key().as_ref()],
        bump = user_account.bump,
    )]
    pub user_account: Account<'info, UserAccount>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub metadata_program: Program<'info, Metadata>,
}

impl<'info> Stake<'info> {
    pub fn stake(&mut self, bumps: &StakeBumps) -> Result<()> {
        // `approve` and the Metaplex freeze both succeed on a zero-balance
        // account, so without this anyone could open an empty ATA for a
        // collection NFT and farm rewards from an NFT they never owned.
        require!(self.nft_token_account.amount == 1, StakeError::NftNotHeld);

        require!(self.user_account.amount_staked < self.config.max_stake, StakeError::MaxStakeReached);

        // `ok_or` rather than `unwrap`: an NFT with no collection is a caller
        // mistake to report, not a panic.
        let collection = self.metadata.collection.as_ref().ok_or(StakeError::MissingCollection)?;
        require!(collection.verified, StakeError::UnverifiedCollection);
        require_keys_eq!(collection.key, self.config.collection, StakeError::InvalidCollection);

        let now = Clock::get()?.unix_timestamp;

        self.stake_account.set_inner(StakeAccount {
            owner: self.user.key(),
            mint: self.nft_mint.key(),
            staked_at: now,
            // Accrual starts now, so the first claim can only ever pay for
            // time after this instruction.
            last_claimed_at: now,
            bump: bumps.stake_account,
        });

        // Step 1: make this NFT's stake account the SPL delegate for the token
        // account. The user signs this, because only the owner can delegate.
        approve(
            CpiContext::new(
                self.token_program.key(),
                Approve {
                    to: self.nft_token_account.to_account_info(),
                    delegate: self.stake_account.to_account_info(),
                    authority: self.user.to_account_info(),
                },
            ),
            1,
        )?;

        // Step 2: freeze the token account. Only the delegate may ask Metaplex
        // to do this, and the delegate is a PDA — so the program signs as it.
        let nft_mint_key = self.nft_mint.key();
        let config_key = self.config.key();
        let seeds = &[b"stake".as_ref(), nft_mint_key.as_ref(), config_key.as_ref(), &[bumps.stake_account]];
        let signer_seeds = &[&seeds[..]];

        freeze_delegated_account(CpiContext::new_with_signer(
            self.metadata_program.key(),
            FreezeDelegatedAccount {
                metadata: self.metadata.to_account_info(),
                delegate: self.stake_account.to_account_info(),
                token_account: self.nft_token_account.to_account_info(),
                edition: self.edition.to_account_info(),
                mint: self.nft_mint.to_account_info(),
                token_program: self.token_program.to_account_info(),
            },
            signer_seeds,
        ))?;

        self.user_account.amount_staked = self.user_account.amount_staked.checked_add(1).ok_or(StakeError::Overflow)?;

        emit!(NftStaked { user: self.user.key(), mint: self.nft_mint.key(), staked_at: now });

        Ok(())
    }
}
