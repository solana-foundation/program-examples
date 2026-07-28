use anchor_lang::prelude::*;

use crate::state::game;

// Instruction Data

pub struct PlayGameInstructionData {
    pub gamer_name: String,
    pub gamer_ticket_count: u32,
    pub game: String,
}

pub fn play_game(ix: PlayGameInstructionData) -> Result<()> {
    let games_list = game::get_games();

    for game in games_list.iter() {
        if ix.game.eq(&game.name) {
            msg!("You're about to play {}!", game.name);

            if ix.gamer_ticket_count < game.tickets {
                msg!("  Sorry {}, you need {} tickets to play {}!", ix.gamer_name, game.tickets, game.name);
            } else {
                msg!("  Let's see what you got!");
                msg!("  You get {} attempts and the prize is a {}!", game.tries, game.prize);
            };

            return Ok(());
        }
    }

    Err(ProgramError::InvalidInstructionData.into())
}
