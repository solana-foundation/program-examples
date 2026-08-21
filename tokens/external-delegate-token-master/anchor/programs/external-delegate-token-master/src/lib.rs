use anchor_lang::prelude::*;
use anchor_spl::token;
use anchor_spl::token::{Token, TokenAccount, Transfer};
use sha3::{Digest, Keccak256};
use solana_secp256k1_recover::secp256k1_recover;

declare_id!("FYPkt5VWMvtyWZDMGCwoKFkE3wXTzphicTpnNGuHWVbD");

#[program]
pub mod external_delegate_token_master {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let user_account = &mut ctx.accounts.user_account;
        user_account.authority = ctx.accounts.authority.key();
        user_account.ethereum_address = [0; 20];
        user_account.nonce = 0;
        Ok(())
    }

    pub fn set_ethereum_address(ctx: Context<SetEthereumAddress>, ethereum_address: [u8; 20]) -> Result<()> {
        let user_account = &mut ctx.accounts.user_account;
        user_account.ethereum_address = ethereum_address;
        Ok(())
    }

    pub fn transfer_tokens(ctx: Context<TransferTokens>, amount: u64, signature: [u8; 65]) -> Result<()> {
        // The digest is derived on-chain from the exact parameters that determine where funds
        // move, plus a nonce, so a signature can't be replayed for a different transfer or reused
        // after it's been consumed. It is signed raw (no EIP-191 prefix), so a wallet's default
        // personal_sign output is intentionally not compatible.
        let digest = transfer_digest(
            &ctx.accounts.user_account.key(),
            &ctx.accounts.user_token_account.key(),
            &ctx.accounts.recipient_token_account.key(),
            amount,
            ctx.accounts.user_account.nonce,
        );

        if !verify_ethereum_signature(&ctx.accounts.user_account.ethereum_address, &digest, &signature) {
            return Err(ErrorCode::InvalidSignature.into());
        }

        let user_account = &mut ctx.accounts.user_account;
        user_account.nonce = user_account.nonce.checked_add(1).ok_or(ErrorCode::NonceOverflow)?;

        // Transfer tokens
        let transfer_instruction = Transfer {
            from: ctx.accounts.user_token_account.to_account_info(),
            to: ctx.accounts.recipient_token_account.to_account_info(),
            authority: ctx.accounts.user_pda.to_account_info(),
        };

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                transfer_instruction,
                &[&[ctx.accounts.user_account.key().as_ref(), &[ctx.bumps.user_pda]]],
            ),
            amount,
        )?;

        Ok(())
    }

    pub fn authority_transfer(ctx: Context<AuthorityTransfer>, amount: u64) -> Result<()> {
        // Transfer tokens
        let transfer_instruction = Transfer {
            from: ctx.accounts.user_token_account.to_account_info(),
            to: ctx.accounts.recipient_token_account.to_account_info(),
            authority: ctx.accounts.user_pda.to_account_info(),
        };

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                transfer_instruction,
                &[&[ctx.accounts.user_account.key().as_ref(), &[ctx.bumps.user_pda]]],
            ),
            amount,
        )?;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = authority, space = 8 + 32 + 20 + 8)]
    // Ensure this is only for user_account
    pub user_account: Account<'info, UserAccount>,
    #[account(mut)]
    pub authority: Signer<'info>, // This should remain as a signer
    pub system_program: Program<'info, System>, // Required for initialization
}

#[derive(Accounts)]
pub struct SetEthereumAddress<'info> {
    #[account(mut, has_one = authority)]
    pub user_account: Account<'info, UserAccount>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct TransferTokens<'info> {
    #[account(mut, has_one = authority)]
    pub user_account: Account<'info, UserAccount>,
    pub authority: Signer<'info>,
    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub recipient_token_account: Account<'info, TokenAccount>,
    #[account(
        seeds = [user_account.key().as_ref()],
        bump,
    )]
    pub user_pda: SystemAccount<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct AuthorityTransfer<'info> {
    #[account(has_one = authority)]
    pub user_account: Account<'info, UserAccount>,
    pub authority: Signer<'info>,
    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub recipient_token_account: Account<'info, TokenAccount>,
    #[account(
        seeds = [user_account.key().as_ref()],
        bump,
    )]
    pub user_pda: SystemAccount<'info>,
    pub token_program: Program<'info, Token>,
}

#[account]
pub struct UserAccount {
    pub authority: Pubkey,
    pub ethereum_address: [u8; 20],
    pub nonce: u64,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Invalid Ethereum signature")]
    InvalidSignature,
    #[msg("Nonce overflow")]
    NonceOverflow,
}

const TRANSFER_DOMAIN: &[u8] = b"external-delegate-token-master:transfer_tokens:v1";

/// Binds every value that determines where funds move (plus a nonce) into the digest that
/// must be Ethereum-signed, so a signature can't be replayed for a different transfer.
fn transfer_digest(
    user_account: &Pubkey,
    user_token_account: &Pubkey,
    recipient_token_account: &Pubkey,
    amount: u64,
    nonce: u64,
) -> [u8; 32] {
    let mut hasher = Keccak256::new();
    hasher.update(TRANSFER_DOMAIN);
    hasher.update(crate::ID.as_ref());
    hasher.update(user_account.as_ref());
    hasher.update(user_token_account.as_ref());
    hasher.update(recipient_token_account.as_ref());
    hasher.update(&amount.to_le_bytes());
    hasher.update(&nonce.to_le_bytes());
    hasher.finalize().into()
}

fn verify_ethereum_signature(ethereum_address: &[u8; 20], digest: &[u8; 32], signature: &[u8; 65]) -> bool {
    let recovery_id = signature[64];
    let mut sig = [0u8; 64];
    sig.copy_from_slice(&signature[..64]);

    if let Ok(pubkey) = secp256k1_recover(digest, recovery_id, &sig) {
        // `to_bytes()` already returns the bare 64-byte X||Y with no 0x04 prefix — do not slice.
        let pubkey_bytes = pubkey.to_bytes();
        let mut recovered_address = [0u8; 20];
        recovered_address.copy_from_slice(&keccak256(&pubkey_bytes[..])[12..]);
        recovered_address == *ethereum_address
    } else {
        false
    }
}

fn keccak256(data: &[u8]) -> [u8; 32] {
    let mut hasher = Keccak256::new();
    hasher.update(data);
    hasher.finalize().into()
}
