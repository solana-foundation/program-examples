use anchor_lang::prelude::*;

pub mod error;
pub mod instructions;
pub mod state;

use crate::instructions::{eat_food, get_on_ride, play_game};

// For setting up modules & configs

declare_id!("8t94SEJh9jVjDwV7cbiuT6BvEsHo4YHP9x9a5rYH1NpP");

#[program]
pub mod carnival {
    use super::*;

    pub fn go_on_ride(
        _ctx: Context<CarnivalContext>,
        name: String,
        height: u32,
        ticket_count: u32,
        ride_name: String,
    ) -> Result<()> {
        get_on_ride::get_on_ride(get_on_ride::GetOnRideInstructionData {
            rider_name: name,
            rider_height: height,
            rider_ticket_count: ticket_count,
            ride: ride_name,
        })
    }

    pub fn play_game(_ctx: Context<CarnivalContext>, name: String, ticket_count: u32, game_name: String) -> Result<()> {
        play_game::play_game(play_game::PlayGameInstructionData {
            gamer_name: name,
            gamer_ticket_count: ticket_count,
            game: game_name,
        })
    }

    pub fn eat_food(
        _ctx: Context<CarnivalContext>,
        name: String,
        ticket_count: u32,
        food_stand_name: String,
    ) -> Result<()> {
        eat_food::eat_food(eat_food::EatFoodInstructionData {
            eater_name: name,
            eater_ticket_count: ticket_count,
            food_stand: food_stand_name,
        })
    }
}

#[derive(Accounts)]
pub struct CarnivalContext<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
}
