//! Event emission engine using Anchor-compatible self-CPI.
//!
//! Events are emitted by invoking this program's own [`EmitEvent`](crate::instructions::emit_event)
//! instruction via CPI, signed by the event authority PDA. Indexers detect these
//! inner instructions by the 8-byte [`EVENT_IX_TAG`] prefix in the instruction data.

use core::mem::size_of;

use alloc::vec::Vec;
use codama::CodamaAccount;
use const_crypto::ed25519;
use pinocchio::cpi::{invoke_signed, Seed, Signer};
use pinocchio::error::ProgramError;
use pinocchio::instruction::{InstructionAccount, InstructionView};
use pinocchio::{AccountView, Address, ProgramResult};

use crate::errors::GachaError;

/// Event authority PDA — no account data, only used for CPI event emission signing.
#[derive(CodamaAccount)]
#[codama(seed(type = string(utf8), value = "event_authority"))]
pub struct EventAuthority;

/// PDA seed for the event authority account.
pub const EVENT_AUTHORITY_SEED: &[u8] = b"event_authority";

/// Anchor-compatible event tag: `Sha256("anchor:event")[..8]`.
pub const EVENT_IX_TAG: u64 = 0x1d9acb512ea545e4;

/// Little-endian byte representation of [`EVENT_IX_TAG`].
pub const EVENT_IX_TAG_LE: [u8; 8] = EVENT_IX_TAG.to_le_bytes();

/// Wire format prefix length: 8-byte tag + 1-byte event discriminator.
pub const EVENT_DISCRIMINATOR_LEN: usize = size_of::<u64>() + 1;

/// Instruction discriminator for the EmitEvent no-op instruction.
pub const EMIT_EVENT_IX_DISC: u8 = 228;

/// Compile-time derived PDA for the event authority.
pub mod event_authority_pda {
    use super::*;

    const EVENT_AUTHORITY_AND_BUMP: ([u8; 32], u8) =
        ed25519::derive_program_address(&[EVENT_AUTHORITY_SEED], crate::ID.as_array());

    /// The event authority PDA address, derived at compile time.
    pub const ID: Address = Address::new_from_array(EVENT_AUTHORITY_AND_BUMP.0);

    /// The PDA bump seed for the event authority.
    pub const BUMP: u8 = EVENT_AUTHORITY_AND_BUMP.1;
}

/// Defines the event discriminator byte used in the wire format prefix.
pub trait EventDiscriminator {
    const DISCRIMINATOR: u8;
}

#[cfg(test)]
fn discriminator_bytes<T: EventDiscriminator>() -> Vec<u8> {
    let mut bytes = Vec::with_capacity(EVENT_DISCRIMINATOR_LEN);
    bytes.extend_from_slice(&EVENT_IX_TAG_LE);
    bytes.push(T::DISCRIMINATOR);
    bytes
}

/// Serializes an event into its wire format: tag + discriminator + field data.
pub trait EventSerialize: EventDiscriminator {
    /// The length of the serialized event data (excluding discriminator).
    const DATA_LEN: usize;

    /// Appends the event's field data to the given buffer.
    fn write_inner(&self, writer: &mut Vec<u8>);

    fn to_bytes(&self) -> Vec<u8> {
        let mut data = Vec::with_capacity(Self::DATA_LEN + EVENT_DISCRIMINATOR_LEN);
        data.extend_from_slice(&EVENT_IX_TAG_LE);
        data.push(Self::DISCRIMINATOR);
        self.write_inner(&mut data);
        data
    }
}

/// Registry of all event discriminator values.
///
/// Each variant's `u8` value is written as the 9th byte of the event wire format
/// (after the 8-byte [`EVENT_IX_TAG_LE`] prefix), letting indexers identify the
/// event type.
#[repr(u8)]
pub enum EventDiscriminators {
    PoolInitialized = 0,
    PullRequested = 1,
    PullSettled = 2,
    PullRefunded = 3,
    FeesWithdrawn = 4,
    PrizeClaimed = 5,
}

impl TryFrom<u8> for EventDiscriminators {
    type Error = u8;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(Self::PoolInitialized),
            1 => Ok(Self::PullRequested),
            2 => Ok(Self::PullSettled),
            3 => Ok(Self::PullRefunded),
            4 => Ok(Self::FeesWithdrawn),
            5 => Ok(Self::PrizeClaimed),
            _ => Err(value),
        }
    }
}

/// Verifies that the given account matches the compile-time event authority PDA.
#[inline(always)]
pub fn verify_event_authority(account: &AccountView) -> Result<(), ProgramError> {
    if account.address() != &event_authority_pda::ID {
        return Err(GachaError::InvalidEventAuthority.into());
    }
    Ok(())
}

/// Emits an event via self-CPI, recording event data in inner instruction data.
pub fn emit_event(
    program_id: &Address,
    event_authority: &AccountView,
    self_program: &AccountView,
    event_data: &[u8],
) -> ProgramResult {
    verify_event_authority(event_authority)?;

    let bump = [event_authority_pda::BUMP];
    let signer_seeds: [Seed; 2] = [Seed::from(EVENT_AUTHORITY_SEED), Seed::from(&bump)];
    let signer = Signer::from(&signer_seeds);

    let accounts = [InstructionAccount::readonly_signer(event_authority.address())];

    let instruction = InstructionView { program_id, data: event_data, accounts: &accounts };

    invoke_signed::<2, _>(&instruction, &[event_authority, self_program], &[signer])
}

#[cfg(test)]
mod tests {
    use super::*;

    struct StubEventA {
        value: u64,
    }

    impl EventDiscriminator for StubEventA {
        const DISCRIMINATOR: u8 = 10;
    }

    impl EventSerialize for StubEventA {
        const DATA_LEN: usize = 8;
        fn write_inner(&self, writer: &mut Vec<u8>) {
            writer.extend_from_slice(&self.value.to_le_bytes());
        }
    }

    #[test]
    fn constants_are_consistent() {
        assert_eq!(EVENT_IX_TAG_LE, EVENT_IX_TAG.to_le_bytes());
        assert_eq!(EVENT_DISCRIMINATOR_LEN, 8 + 1);
    }

    #[test]
    fn to_bytes_prepends_tag_and_discriminator() {
        let event = StubEventA { value: 42 };
        let bytes = event.to_bytes();
        assert_eq!(&bytes[..8], &EVENT_IX_TAG_LE);
        assert_eq!(bytes[8], StubEventA::DISCRIMINATOR);
        assert_eq!(&bytes[9..], &42u64.to_le_bytes());
    }

    #[test]
    fn discriminator_bytes_has_correct_prefix() {
        let disc = discriminator_bytes::<StubEventA>();
        assert_eq!(disc.len(), EVENT_DISCRIMINATOR_LEN);
        assert_eq!(&disc[..8], &EVENT_IX_TAG_LE);
        assert_eq!(disc[8], StubEventA::DISCRIMINATOR);
    }
}
