use pinocchio::{
    cpi::Seed,
    error::ProgramError,
    sysvars::{clock::Clock, Sysvar},
    AccountView, Address, ProgramResult,
};
use pinocchio_log::log;

use crate::{
    instructions::{expect_pda, read_prefixed},
    state::{Player, GAME_DATA_SIZE, PLAYER_SEED, PLAYER_SIZE},
    util::create_pda_account,
};

/// Creates a player, and the shared level they are playing on if it is new.
///
/// The level is keyed by a caller-chosen seed, so several levels can run side
/// by side; the first player to touch one pays for it.
///
/// Accounts:
///   0. `[writable]`         player (PDA `[b"player", signer]`)
///   1. `[writable]`         game data (PDA `[level_seed]`)
///   2. `[signer, writable]` signer (pays, becomes the player's authority)
///   3. `[]`                 system program
///
/// Instruction data: `[level_seed_len: u8, level_seed]`
pub fn init_player(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    let [player, game_data, signer, _system_program] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    if !signer.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let level_seed = read_prefixed(data, 0)?;

    let player_bump = expect_pda(program_id, player, &[PLAYER_SEED, signer.address().as_ref()])?;
    let player_bump_bytes = [player_bump];
    let player_seeds = [Seed::from(PLAYER_SEED), Seed::from(signer.address().as_ref()), Seed::from(&player_bump_bytes)];

    log!("Creating player");
    create_pda_account(signer, player, PLAYER_SIZE, program_id, &player_seeds)?;
    Player::from_bytes(&mut player.try_borrow_mut()?)?.initialize(signer.address(), Clock::get()?.unix_timestamp);

    // The level is shared, so it already exists for everyone after the first
    // player. Recreating it would fail and take this player's creation with it.
    if game_data.is_data_empty() {
        let game_bump = expect_pda(program_id, game_data, &[level_seed])?;
        let game_bump_bytes = [game_bump];
        let game_seeds = [Seed::from(level_seed), Seed::from(&game_bump_bytes)];

        log!("Creating level");
        create_pda_account(signer, game_data, GAME_DATA_SIZE, program_id, &game_seeds)?;
    } else {
        expect_pda(program_id, game_data, &[level_seed])?;
    }

    log!("Player ready");
    Ok(())
}
