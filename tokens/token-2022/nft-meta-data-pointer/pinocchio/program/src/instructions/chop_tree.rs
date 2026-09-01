use pinocchio::{
    cpi::{Seed, Signer},
    error::ProgramError,
    sysvars::{clock::Clock, Sysvar},
    AccountView, Address, ProgramResult,
};
use pinocchio_log::log;

use crate::{
    error::GameError,
    instructions::top_up_rent,
    instructions::{expect_pda, expect_token_holding, expect_token_program, read_prefixed, TOKEN_2022_PROGRAM_ID},
    metadata::{metadata_update_field, u64_to_decimal},
    state::{on_tree_chopped, Player, GAME_DATA_SIZE, NFT_AUTHORITY_SEED, PLAYER_SEED},
};

/// Wood gained, and energy spent, per chop. The reference fixes this at one.
const CHOP_AMOUNT: u64 = 1;

/// The metadata key holding the player's wood, rewritten on every chop.
const WOOD_KEY: &[u8] = b"wood";

/// Chops the shared tree: spends energy, banks wood, and writes the new total
/// onto the player's NFT.
///
/// The last step is the point of the example — the token's own metadata is the
/// live game state, so a wallet showing the NFT shows current progress without
/// anything indexing this program.
///
/// `counter` is not read; it exists so a player can send several chops in the
/// same block without two transactions colliding on an identical signature.
///
/// Accounts:
///   0. `[writable]`         player (PDA `[b"player", signer]`)
///   1. `[writable]`         game data (PDA `[level_seed]`)
///   2. `[signer, writable]` signer (must be the player's authority)
///   3. `[writable]`         the player's NFT mint
///   4. `[]`                 the signer's token account for that mint
///   5. `[]`                 nft authority (PDA `[b"nft_authority"]`)
///   6. `[]`                 Token-2022 program
///   7. `[]`                 system program
///
/// Instruction data: `[counter: u16 (LE), level_seed_len: u8, level_seed]`
pub fn chop_tree(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    let [player, game_data, signer, mint, token_account, nft_authority, token_program, _system_program] = accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    if !signer.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }
    expect_token_program(token_program)?;

    let counter = u16::from_le_bytes(
        data.get(..2)
            .ok_or(ProgramError::InvalidInstructionData)?
            .try_into()
            .map_err(|_| ProgramError::InvalidInstructionData)?,
    );
    let level_seed = read_prefixed(data, 2)?;

    expect_pda(program_id, player, &[PLAYER_SEED, signer.address().as_ref()])?;
    expect_pda(program_id, game_data, &[level_seed])?;
    if !player.owned_by(program_id) || !game_data.owned_by(program_id) || game_data.data_len() != GAME_DATA_SIZE {
        return Err(GameError::InvalidAccountData.into());
    }

    let wood = {
        let mut player_data = player.try_borrow_mut()?;
        let mut state = Player::from_bytes(&mut player_data)?;

        // The reference reaches the same conclusion through its session-key
        // macro's fallback arm; without session keys, the player's own
        // signature is the only way in.
        if state.authority() != signer.address().as_ref() {
            return Err(GameError::WrongAuthority.into());
        }

        state.update_energy(Clock::get()?.unix_timestamp);
        if state.energy() < CHOP_AMOUNT {
            return Err(GameError::NotEnoughEnergy.into());
        }

        state.set_last_id(counter);
        state.chop_tree(CHOP_AMOUNT);
        state.wood()
    };

    on_tree_chopped(&mut game_data.try_borrow_mut()?, CHOP_AMOUNT)?;

    log!("Chopped a tree, wood now {}", wood);

    // The mint's metadata update authority is a PDA of this program, which is
    // what lets the program keep the NFT current without the player holding any
    // authority over it.
    let bump = expect_pda(program_id, nft_authority, &[NFT_AUTHORITY_SEED])?;
    let bump_bytes = [bump];
    let seeds = [Seed::from(NFT_AUTHORITY_SEED), Seed::from(&bump_bytes)];

    if !mint.owned_by(&TOKEN_2022_PROGRAM_ID) {
        return Err(GameError::InvalidAccountData.into());
    }

    // Every NFT this program mints answers to the same metadata authority, so
    // holding the token is what separates the player's own NFT from anyone
    // else's.
    expect_token_holding(token_account, mint, signer.address())?;

    metadata_update_field(
        &TOKEN_2022_PROGRAM_ID,
        mint,
        nft_authority,
        WOOD_KEY,
        &u64_to_decimal(wood),
        &[Signer::from(&seeds)],
    )?;

    // Writing a longer value grows the mint, so it can fall below rent
    // exemption; top it up from the player.
    top_up_rent(signer, mint)?;

    Ok(())
}
