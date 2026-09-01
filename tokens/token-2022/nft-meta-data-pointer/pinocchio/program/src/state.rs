//! Game state, seeds and tuning constants.
//!
//! Written as plain little-endian bytes. There is no 8-byte Anchor account
//! discriminator, and the accounts are sized to what they hold rather than the
//! reference's flat 1000 bytes of expansion room.

use pinocchio::{error::ProgramError, Address};

use crate::error::GameError;

/// Seed prefix of a player's account.
pub const PLAYER_SEED: &[u8] = b"player";

/// Seed of the PDA that owns every NFT this program mints.
pub const NFT_AUTHORITY_SEED: &[u8] = b"nft_authority";

/// Seconds of real time that restore one unit of energy.
pub const TIME_TO_REFILL_ENERGY: i64 = 60;

/// Energy a player refills to, and starts with.
pub const MAX_ENERGY: u64 = 100;

/// Wood a tree yields before it is replaced by a fresh one.
pub const MAX_WOOD_PER_TREE: u64 = 100_000;

/// `authority(32) | level(1) | xp(8) | wood(8) | energy(8) | last_login(8) | last_id(2)`
///
/// The reference also carries a `name: String` that nothing ever writes, and
/// pads every account to 1000 bytes for future expansion. Neither is carried
/// over — a hand-rolled layout has no macro to grow around, so the size is just
/// what the fields need.
pub const PLAYER_SIZE: usize = 67;

/// `total_wood_collected(8)`
pub const GAME_DATA_SIZE: usize = 8;

const WOOD_RANGE: core::ops::Range<usize> = 41..49;
const ENERGY_RANGE: core::ops::Range<usize> = 49..57;
const LAST_LOGIN_RANGE: core::ops::Range<usize> = 57..65;
const LAST_ID_RANGE: core::ops::Range<usize> = 65..67;

pub struct Player<'a>(&'a mut [u8]);

impl<'a> Player<'a> {
    pub fn from_bytes(data: &'a mut [u8]) -> Result<Self, ProgramError> {
        if data.len() != PLAYER_SIZE {
            return Err(GameError::InvalidAccountData.into());
        }
        Ok(Self(data))
    }

    pub fn authority(&self) -> &[u8] {
        &self.0[..32]
    }

    pub fn wood(&self) -> u64 {
        u64::from_le_bytes(self.0[WOOD_RANGE].try_into().unwrap())
    }

    pub fn energy(&self) -> u64 {
        u64::from_le_bytes(self.0[ENERGY_RANGE].try_into().unwrap())
    }

    pub fn last_login(&self) -> i64 {
        i64::from_le_bytes(self.0[LAST_LOGIN_RANGE].try_into().unwrap())
    }

    fn set_wood(&mut self, value: u64) {
        self.0[WOOD_RANGE].copy_from_slice(&value.to_le_bytes());
    }

    fn set_energy(&mut self, value: u64) {
        self.0[ENERGY_RANGE].copy_from_slice(&value.to_le_bytes());
    }

    fn set_last_login(&mut self, value: i64) {
        self.0[LAST_LOGIN_RANGE].copy_from_slice(&value.to_le_bytes());
    }

    pub fn set_last_id(&mut self, value: u16) {
        self.0[LAST_ID_RANGE].copy_from_slice(&value.to_le_bytes());
    }

    pub fn initialize(&mut self, authority: &Address, now: i64) {
        self.0.fill(0);
        self.0[..32].copy_from_slice(authority.as_ref());
        self.set_energy(MAX_ENERGY);
        self.set_last_login(now);
    }

    /// Restores one energy per `TIME_TO_REFILL_ENERGY` seconds elapsed.
    ///
    /// Only the time actually spent refilling is consumed, so the remainder
    /// still counts towards the next unit — but once full, the clock resets to
    /// now and any banked time is dropped, exactly as the reference does.
    pub fn update_energy(&mut self, now: i64) {
        let mut time_passed = now.saturating_sub(self.last_login());
        let mut time_spent = 0i64;
        let mut energy = self.energy();

        while time_passed >= TIME_TO_REFILL_ENERGY && energy < MAX_ENERGY {
            energy += 1;
            time_passed -= TIME_TO_REFILL_ENERGY;
            time_spent += TIME_TO_REFILL_ENERGY;
        }

        self.set_energy(energy);
        if energy >= MAX_ENERGY {
            self.set_last_login(now);
        } else {
            self.set_last_login(self.last_login().saturating_add(time_spent));
        }
    }

    /// Trades `amount` energy for `amount` wood.
    ///
    /// The caller has already refused the transaction if energy is short, so
    /// the subtraction cannot underflow; wood saturates rather than wrapping.
    pub fn chop_tree(&mut self, amount: u64) {
        self.set_wood(self.wood().saturating_add(amount));
        self.set_energy(self.energy().saturating_sub(amount));
    }
}

pub fn read_game_total(data: &[u8]) -> Result<u64, ProgramError> {
    if data.len() != GAME_DATA_SIZE {
        return Err(GameError::InvalidAccountData.into());
    }
    Ok(u64::from_le_bytes(data.try_into().unwrap()))
}

/// Adds a chop to the shared tree, starting a fresh one once it is exhausted.
///
/// The comparison is against the total *before* the chop, matching the
/// reference — so the tree resets on the chop after it reaches the maximum
/// rather than the one that reaches it.
pub fn on_tree_chopped(data: &mut [u8], amount: u64) -> Result<(), ProgramError> {
    let total = read_game_total(data)?;
    let next = match total.checked_add(amount) {
        Some(next) => {
            if total >= MAX_WOOD_PER_TREE {
                0
            } else {
                next
            }
        }
        // The reference leaves the total untouched on overflow.
        None => total,
    };
    data.copy_from_slice(&next.to_le_bytes());
    Ok(())
}
