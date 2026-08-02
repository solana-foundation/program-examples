use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{
        mint_to, set_authority, transfer_checked, Mint, MintTo, SetAuthority, Token, TokenAccount, TransferChecked,
    },
};
use sha2::{Digest, Sha256};

declare_id!("GTCPuHiGookQVSAgGc7CzBiFYPytjVAq6vdCV3NnZoHa");

#[program]
pub mod merkle_tree_token_claimer {
    use anchor_spl::token::spl_token::instruction::AuthorityType;

    use super::*;

    pub fn initialize_airdrop_data(ctx: Context<Initialize>, merkle_root: [u8; 32], amount: u64) -> Result<()> {
        require!(amount > 0, ClaimError::InvalidAmount);

        ctx.accounts.airdrop_state.set_inner(AirdropState {
            merkle_root,
            authority: ctx.accounts.authority.key(),
            mint: ctx.accounts.mint.key(),
            airdrop_amount: amount,
            amount_claimed: 0,
            bump: ctx.bumps.airdrop_state,
        });

        mint_to(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                MintTo {
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.authority.to_account_info(),
                },
            ),
            amount,
        )?;

        set_authority(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                SetAuthority {
                    current_authority: ctx.accounts.authority.to_account_info(),
                    account_or_mint: ctx.accounts.mint.to_account_info(),
                },
            ),
            AuthorityType::MintTokens,
            None,
        )?;

        Ok(())
    }

    pub fn update_tree(ctx: Context<Update>, new_root: [u8; 32]) -> Result<()> {
        require!(ctx.accounts.airdrop_state.amount_claimed == 0, ClaimError::ClaimsStarted);

        ctx.accounts.airdrop_state.merkle_root = new_root;

        Ok(())
    }

    pub fn claim_airdrop(ctx: Context<Claim>, amount: u64, hashes: Vec<u8>, index: u64) -> Result<()> {
        require!(amount > 0, ClaimError::InvalidAmount);
        require!(ctx.accounts.claim_receipt.claimer == Pubkey::default(), ClaimError::AlreadyClaimed);

        let airdrop_state = &mut ctx.accounts.airdrop_state;
        let mut leaf = Vec::with_capacity(40);
        leaf.extend_from_slice(&ctx.accounts.signer.key().to_bytes());
        leaf.extend_from_slice(&amount.to_le_bytes());

        let computed_root = compute_merkle_root(&leaf, &hashes, index)?;

        require!(computed_root.eq(&airdrop_state.merkle_root), ClaimError::InvalidProof);

        let new_amount_claimed = airdrop_state.amount_claimed.checked_add(amount).ok_or(ClaimError::AmountOverflow)?;
        require!(new_amount_claimed <= airdrop_state.airdrop_amount, ClaimError::ClaimExceedsAirdrop);

        let mint_key = ctx.accounts.mint.key().to_bytes();
        let signer_seeds = &[b"merkle_tree".as_ref(), mint_key.as_ref(), &[airdrop_state.bump]];

        transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.vault.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.signer_ata.to_account_info(),
                    authority: airdrop_state.to_account_info(),
                },
                &[signer_seeds],
            ),
            amount,
            ctx.accounts.mint.decimals,
        )?;

        ctx.accounts.claim_receipt.set_inner(ClaimReceipt {
            airdrop_state: airdrop_state.key(),
            claimer: ctx.accounts.signer.key(),
            index,
            amount,
            bump: ctx.bumps.claim_receipt,
        });

        airdrop_state.amount_claimed = new_amount_claimed;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        seeds = [b"merkle_tree".as_ref(), mint.key().to_bytes().as_ref()],
        bump,
        payer = authority,
        space = 8 + AirdropState::INIT_SPACE
    )]
    pub airdrop_state: Account<'info, AirdropState>,
    #[account(
        init,
        payer = authority,
        mint::authority = authority,
        mint::decimals = 6,
    )]
    pub mint: Account<'info, Mint>,
    #[account(
        init_if_needed,
        payer = authority,
        associated_token::mint = mint,
        associated_token::authority = airdrop_state,
    )]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[derive(Accounts)]
pub struct Update<'info> {
    #[account(
        mut,
        has_one = authority,
        has_one = mint,
        seeds = [b"merkle_tree".as_ref(), mint.key().to_bytes().as_ref()],
        bump = airdrop_state.bump
    )]
    pub airdrop_state: Account<'info, AirdropState>,
    pub mint: Account<'info, Mint>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(amount: u64, hashes: Vec<u8>, index: u64)]
pub struct Claim<'info> {
    #[account(
        mut,
        has_one = mint,
        seeds = [b"merkle_tree".as_ref(), mint.key().to_bytes().as_ref()],
        bump = airdrop_state.bump
    )]
    pub airdrop_state: Account<'info, AirdropState>,
    pub mint: Account<'info, Mint>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = airdrop_state,
    )]
    pub vault: Account<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = signer,
        space = 8 + ClaimReceipt::INIT_SPACE,
        seeds = [
            b"claim_receipt".as_ref(),
            airdrop_state.key().as_ref(),
            index.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub claim_receipt: Account<'info, ClaimReceipt>,
    #[account(
        init_if_needed,
        payer = signer,
        associated_token::mint = mint,
        associated_token::authority = signer,
    )]
    pub signer_ata: Account<'info, TokenAccount>,
    #[account(mut)]
    pub signer: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[account]
#[derive(InitSpace)]
pub struct AirdropState {
    pub merkle_root: [u8; 32],
    pub authority: Pubkey,
    pub mint: Pubkey,
    pub airdrop_amount: u64,
    pub amount_claimed: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct ClaimReceipt {
    pub airdrop_state: Pubkey,
    pub claimer: Pubkey,
    pub index: u64,
    pub amount: u64,
    pub bump: u8,
}

#[error_code]
pub enum ClaimError {
    #[msg("Invalid Merkle proof")]
    InvalidProof,
    #[msg("This claim has already been processed")]
    AlreadyClaimed,
    #[msg("Amount overflow")]
    AmountOverflow,
    #[msg("The requested claim would exceed the initialized airdrop amount")]
    ClaimExceedsAirdrop,
    #[msg("The Merkle tree can only be updated before any claims are processed")]
    ClaimsStarted,
    #[msg("Claim amount must be greater than zero")]
    InvalidAmount,
}

// The tree builder must pad odd levels with a zero hash (see tests/merkle.ts):
// duplicating the last node instead would make its parent sha256(C || C), which
// verifies at two indices and therefore two receipt PDAs.
fn compute_merkle_root(leaf: &[u8], hashes: &[u8], mut index: u64) -> Result<[u8; 32]> {
    require!(hashes.len() % 32 == 0, ClaimError::InvalidProof);

    let mut current = sha256(leaf);

    for sibling in hashes.chunks_exact(32) {
        let sibling_hash: [u8; 32] = sibling.try_into().map_err(|_| ClaimError::InvalidProof)?;
        current = if index % 2 == 0 { hash_pair(&current, &sibling_hash) } else { hash_pair(&sibling_hash, &current) };
        index /= 2;
    }

    // Index bits beyond the proof depth are never authenticated by the loop
    // above; without this check the same proof could open receipt PDAs at
    // index + 2^depth, index + 2^(depth+1), and so on.
    require!(index == 0, ClaimError::InvalidProof);

    Ok(current)
}

fn hash_pair(left: &[u8; 32], right: &[u8; 32]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(left);
    hasher.update(right);
    hasher.finalize().into()
}

fn sha256(bytes: &[u8]) -> [u8; 32] {
    Sha256::digest(bytes).into()
}
