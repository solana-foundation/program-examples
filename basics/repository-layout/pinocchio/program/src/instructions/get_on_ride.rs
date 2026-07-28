use pinocchio::{error::ProgramError, ProgramResult};
use pinocchio_log::log;

use crate::state::ride;

// InstructionData Data

pub struct GetOnRideInstructionData<'a> {
    pub rider_name: &'a str,
    pub rider_height: u32,
    pub rider_ticket_count: u32,
    pub ride: &'a str,
}

pub fn get_on_ride(ix: GetOnRideInstructionData) -> ProgramResult {
    for ride in ride::RIDES.iter() {
        if ix.ride == ride.name {
            log!("You're about to ride the {}!", ride.name);

            if ix.rider_ticket_count < ride.tickets {
                log!("  Sorry {}, you need {} tickets to ride the {}!", ix.rider_name, ride.tickets, ride.name);
                return Ok(());
            };

            if ix.rider_height < ride.min_height {
                log!("  Sorry {}, you need to be {} tall to ride the {}!", ix.rider_name, ride.min_height, ride.name);
                return Ok(());
            };

            log!("  Welcome aboard the {}!", ride.name);

            if ride.upside_down {
                log!("  Btw, this ride goes upside down. Hold on tight!");
            };

            return Ok(());
        }
    }

    Err(ProgramError::InvalidInstructionData)
}
