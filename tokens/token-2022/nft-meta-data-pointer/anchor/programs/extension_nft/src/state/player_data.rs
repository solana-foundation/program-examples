use crate::constants::*;
use anchor_lang::prelude::*;

#[account]
pub struct PlayerData {
    pub authority: Pubkey,
    pub name: String,
    pub level: u8,
    pub xp: u64,
    pub wood: u64,
    pub energy: u64,
    pub last_login: i64,
    pub last_id: u16,
}

impl PlayerData {
    pub fn print(&mut self) -> Result<()> {
        // Note that logging costs a lot of compute. So don't use it too much.
        msg!(
            "Authority: {} Wood: {} Energy: {}",
            self.authority,
            self.wood,
            self.energy
        );
        Ok(())
    }

    pub fn update_energy(&mut self) -> Result<()> {
        // Get the current timestamp
        let current_timestamp = Clock::get()?.unix_timestamp;

        // Calculate the time passed since the last login
        let mut time_passed: i64 = current_timestamp - self.last_login;

        // Calculate the time spent refilling energy
        let mut time_spent = 0;

        while time_passed >= TIME_TO_REFILL_ENERGY && self.energy < MAX_ENERGY {
            self.energy += 1;
            time_passed -= TIME_TO_REFILL_ENERGY;
            time_spent += TIME_TO_REFILL_ENERGY;
        }

        if self.energy >= MAX_ENERGY {
            self.last_login = current_timestamp;
        } else {
            self.last_login += time_spent;
        }

        Ok(())
    }

    pub fn chop_tree(&mut self, amount: u64) -> Result<()> {
        match self.wood.checked_add(amount) {
            Some(v) => {
                self.wood = v;
            }
            None => {
                msg!("Total wood reached!");
            }
        };
        match self.energy.checked_sub(amount) {
            Some(v) => {
                self.energy = v;
            }
            None => {
                self.energy = 0;
            }
        };
        Ok(())
    }
}
