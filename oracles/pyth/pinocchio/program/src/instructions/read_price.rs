use pinocchio::{error::ProgramError, AccountView, ProgramResult};
use pinocchio_log::log;

use crate::instructions::PYTH_RECEIVER_PROGRAM_ID;

/// Anchor account discriminator for `PriceUpdateV2` — the first 8 bytes of
/// `sha256("account:PriceUpdateV2")`.
const PRICE_UPDATE_V2_DISCRIMINATOR: [u8; 8] = [34, 241, 35, 99, 157, 126, 244, 205];

/// Byte offset of the `VerificationLevel` field: past the 8-byte discriminator
/// and the 32-byte write authority.
const VERIFICATION_LEVEL_OFFSET: usize = 8 + 32;

/// `VerificationLevel` is a Borsh enum: `Partial { num_signatures: u8 }` is the
/// first variant (`[0, n]`, two bytes) and `Full` the second (`[1]`, one byte),
/// so the `PriceFeedMessage` that follows starts one or two bytes later. Any
/// other discriminant is an invalid account.
const VERIFICATION_LEVEL_PARTIAL: u8 = 0;
const VERIFICATION_LEVEL_FULL: u8 = 1;

/// Field offsets within the `PriceFeedMessage`, which begins right after the
/// verification level: `feed_id [u8; 32]`, `price: i64`, `conf: u64`,
/// `exponent: i32`, `publish_time: i64`, … (all little-endian).
const FEED_ID_LEN: usize = 32;
const PRICE_OFFSET: usize = FEED_ID_LEN;
const CONF_OFFSET: usize = PRICE_OFFSET + 8;
const EXPONENT_OFFSET: usize = CONF_OFFSET + 8;
const PUBLISH_TIME_OFFSET: usize = EXPONENT_OFFSET + 4;

/// Reads and logs the latest price from a Pyth `PriceUpdateV2` account.
///
/// There is no Pyth SDK for Pinocchio, so the account is parsed by hand. The
/// account's owner and discriminator are checked first so the program never
/// trusts the price data of an arbitrary account.
///
/// Accounts:
///   0. `[]` price update account (a Pyth `PriceUpdateV2`)
pub fn read_price(accounts: &[AccountView]) -> ProgramResult {
    let [price_update, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // Only trust price data from an account owned by the Pyth receiver program.
    if price_update.owner() != &PYTH_RECEIVER_PROGRAM_ID {
        return Err(ProgramError::IllegalOwner);
    }

    let data = price_update.try_borrow()?;
    if data.get(..PRICE_UPDATE_V2_DISCRIMINATOR.len()) != Some(PRICE_UPDATE_V2_DISCRIMINATOR.as_slice()) {
        return Err(ProgramError::InvalidAccountData);
    }

    // `Full` verification uses one byte and `Partial` uses two, shifting the
    // price message; any other discriminant is a malformed account.
    let verification_level = *data.get(VERIFICATION_LEVEL_OFFSET).ok_or(ProgramError::InvalidAccountData)?;
    let message_offset = match verification_level {
        VERIFICATION_LEVEL_FULL => VERIFICATION_LEVEL_OFFSET + 1,
        VERIFICATION_LEVEL_PARTIAL => VERIFICATION_LEVEL_OFFSET + 2,
        _ => return Err(ProgramError::InvalidAccountData),
    };

    // The `feed_id [u8; 32]` sits at the start of the message; this example reads
    // the numeric price fields that follow it.
    let price = i64::from_le_bytes(read_bytes::<8>(&data, message_offset + PRICE_OFFSET)?);
    let conf = u64::from_le_bytes(read_bytes::<8>(&data, message_offset + CONF_OFFSET)?);
    let exponent = i32::from_le_bytes(read_bytes::<4>(&data, message_offset + EXPONENT_OFFSET)?);
    let publish_time = i64::from_le_bytes(read_bytes::<8>(&data, message_offset + PUBLISH_TIME_OFFSET)?);

    log!("Price: {}", price);
    log!("Confidence: {}", conf);
    log!("Exponent: {}", exponent);
    log!("Publish time: {}", publish_time);

    Ok(())
}

/// Copies a fixed-size byte array out of `data` at `offset`, or fails if the
/// account is too short.
fn read_bytes<const N: usize>(data: &[u8], offset: usize) -> Result<[u8; N], ProgramError> {
    data.get(offset..offset + N).and_then(|slice| slice.try_into().ok()).ok_or(ProgramError::InvalidAccountData)
}
