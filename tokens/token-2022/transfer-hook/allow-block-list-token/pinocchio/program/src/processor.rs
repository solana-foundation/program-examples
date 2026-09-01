use pinocchio::{error::ProgramError, AccountView, Address, ProgramResult};
use pinocchio_log::log;

use crate::instructions::{
    attach_to_mint, change_mode, init_config, init_mint, init_wallet, remove_wallet, resize_meta_list, tx_hook,
};

/// `spl-transfer-hook-interface:execute`, the first eight bytes of its sha256.
///
/// Fixed by the interface: Token-2022 CPIs this program with exactly these
/// bytes during a transfer.
const EXECUTE: [u8; 8] = [105, 37, 101, 197, 75, 251, 102, 26];

/// This example's own instructions. Single-byte tags, none of which can shadow
/// the eight-byte discriminator above, which starts with 105.
const INIT_CONFIG: u8 = 0;
const INIT_MINT: u8 = 1;
const ATTACH_TO_MINT: u8 = 2;
const INIT_WALLET: u8 = 3;
const REMOVE_WALLET: u8 = 4;
const CHANGE_MODE: u8 = 5;
const RESIZE_META_LIST: u8 = 6;

/// Entrypoint for the program.
pub fn process_instruction(
    program_id: &Address,
    accounts: &mut [AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // The interface discriminator is matched first: it is eight bytes, so a
    // one-byte tag could otherwise shadow it.
    if let Some(data) = instruction_data.strip_prefix(&EXECUTE) {
        log!("Instruction: Execute");
        return tx_hook(program_id, accounts, data);
    }

    match instruction_data {
        [INIT_CONFIG, ..] => {
            log!("Instruction: InitConfig");
            init_config(program_id, accounts)
        }
        [INIT_MINT, data @ ..] => {
            log!("Instruction: InitMint");
            init_mint(program_id, accounts, data)
        }
        [ATTACH_TO_MINT, ..] => {
            log!("Instruction: AttachToMint");
            attach_to_mint(program_id, accounts)
        }
        [INIT_WALLET, data @ ..] => {
            log!("Instruction: InitWallet");
            init_wallet(program_id, accounts, data)
        }
        [REMOVE_WALLET, ..] => {
            log!("Instruction: RemoveWallet");
            remove_wallet(program_id, accounts)
        }
        [CHANGE_MODE, data @ ..] => {
            log!("Instruction: ChangeMode");
            change_mode(program_id, accounts, data)
        }
        [RESIZE_META_LIST, ..] => {
            log!("Instruction: ResizeMetaList");
            resize_meta_list(program_id, accounts)
        }
        _ => Err(ProgramError::InvalidInstructionData),
    }
}
