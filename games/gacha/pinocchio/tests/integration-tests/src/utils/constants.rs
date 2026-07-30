use solana_pubkey::Pubkey;

pub static PROGRAM_ID: Pubkey = Pubkey::new_from_array(crate::ID.to_bytes());
pub static SYSTEM_PROGRAM_ID: Pubkey = Pubkey::new_from_array([0u8; 32]);
pub static EVENT_AUTHORITY: Pubkey = Pubkey::new_from_array(crate::event_engine::event_authority_pda::ID.to_bytes());

pub static TOKEN_2022_ID: Pubkey = Pubkey::from_str_const("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
pub static ATA_PROGRAM_ID: Pubkey = Pubkey::from_str_const("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

pub static CC_VRF_ID: Pubkey = Pubkey::new_from_array(crate::ccvrf::CC_VRF_PROGRAM_ID.to_bytes());
pub static LIGHT_SYSTEM_PROGRAM_ID: Pubkey = Pubkey::new_from_array(crate::ccvrf::LIGHT_SYSTEM_PROGRAM_ID.to_bytes());
pub static CC_VRF_CPI_AUTHORITY: Pubkey = Pubkey::new_from_array(crate::ccvrf::CC_VRF_CPI_AUTHORITY.to_bytes());
pub static REGISTERED_PROGRAM_PDA: Pubkey = Pubkey::new_from_array(crate::ccvrf::REGISTERED_PROGRAM_PDA.to_bytes());
pub static ACCOUNT_COMPRESSION_AUTHORITY: Pubkey =
    Pubkey::new_from_array(crate::ccvrf::ACCOUNT_COMPRESSION_AUTHORITY.to_bytes());
pub static ACCOUNT_COMPRESSION_PROGRAM_ID: Pubkey =
    Pubkey::new_from_array(crate::ccvrf::ACCOUNT_COMPRESSION_PROGRAM_ID.to_bytes());
pub static ADDRESS_TREE_V2: Pubkey = Pubkey::new_from_array(crate::ccvrf::ADDRESS_TREE_V2.to_bytes());
