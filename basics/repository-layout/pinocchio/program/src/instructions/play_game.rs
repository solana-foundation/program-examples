use pinocchio::{error::ProgramError, ProgramResult};
use pinocchio_log::log;

use crate::state::game;

// InstructionData Data

pub struct PlayGameInstructionData<'a> {
    pub gamer_name: &'a str,
    pub gamer_ticket_count: u32,
    pub game: &'a str,
}

pub fn play_game(ix: PlayGameInstructionData) -> ProgramResult {
    for game in game::GAMES.iter() {
        if ix.game == game.name {
            log!("You're about to play {}!", game.name);

            if ix.gamer_ticket_count < game.tickets {
                log!("  Sorry {}, you need {} tickets to play {}!", ix.gamer_name, game.tickets, game.name);
            } else {
                log!("  Let's see what you got!");
                log!("  You get {} attempts and the prize is a {}!", game.tries, game.prize);
            };

            return Ok(());
        }
    }

    Err(ProgramError::InvalidInstructionData)
}
