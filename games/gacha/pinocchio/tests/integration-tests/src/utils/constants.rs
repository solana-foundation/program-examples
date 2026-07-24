use solana_pubkey::Pubkey;

pub static PROGRAM_ID: Pubkey = Pubkey::new_from_array(crate::ID.to_bytes());
pub static SYSTEM_PROGRAM_ID: Pubkey = Pubkey::new_from_array([0u8; 32]);
pub static EVENT_AUTHORITY: Pubkey = Pubkey::new_from_array(crate::event_engine::event_authority_pda::ID.to_bytes());
