use pinocchio::{error::ProgramError, AccountView, Address, ProgramResult};
use pinocchio_log::log;

use crate::instructions::{initialize, initialize_extra_account_meta_list, transfer_hook};

/// `spl-transfer-hook-interface` discriminators: the first eight bytes of
/// `sha256("spl-transfer-hook-interface:<instruction>")`.
///
/// These are fixed by the interface rather than chosen here — Token-2022 CPIs
/// this program with `EXECUTE` during a transfer, so the program is only usable
/// as a hook if it answers to exactly these bytes.
const EXECUTE: [u8; 8] = [105, 37, 101, 197, 75, 251, 102, 26];
const INITIALIZE_EXTRA_ACCOUNT_META_LIST: [u8; 8] = [43, 34, 13, 49, 167, 88, 235, 235];

/// Creating the mint is this example's own convenience instruction, not part of
/// the interface, so its discriminator is a single byte we pick. It cannot
/// collide with the two above, which start with 105 and 43.
const INITIALIZE: u8 = 0;

/// Entrypoint for the program.
pub fn process_instruction(
    program_id: &Address,
    accounts: &mut [AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // The interface discriminators are matched first: they are eight bytes, so
    // a one-byte tag could otherwise shadow them.
    if let Some(data) = instruction_data.strip_prefix(&EXECUTE) {
        log!("Instruction: Execute");
        return transfer_hook(program_id, accounts, data);
    }

    if instruction_data.starts_with(&INITIALIZE_EXTRA_ACCOUNT_META_LIST) {
        log!("Instruction: InitializeExtraAccountMetaList");
        return initialize_extra_account_meta_list(program_id, accounts);
    }

    match instruction_data {
        [INITIALIZE, data @ ..] => {
            log!("Instruction: Initialize");
            initialize(program_id, accounts, data)
        }
        _ => Err(ProgramError::InvalidInstructionData),
    }
}
