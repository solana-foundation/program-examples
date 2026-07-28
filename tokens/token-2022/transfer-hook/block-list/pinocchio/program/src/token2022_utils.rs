use pinocchio::{AccountView, Address};

pub const TOKEN_2022_PROGRAM_ID: Address = Address::from_str_const("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

pub const EXTRA_METAS_SEED: &[u8] = b"extra-account-metas";

const MINT_LEN: usize = 82;
const EXTENSIONS_PADDING: usize = 83;
const EXTENSION_START_OFFSET: usize = 1;
const EXTENSION_LENGTH_LEN: usize = 2;
const EXTENSION_TYPE_LEN: usize = 2;
const TRANSFER_HOOK_EXTENSION_TYPE: u16 = 14;
const IMMUTABLE_OWNER_EXTENSION_TYPE: u16 = 7;
const TYPE_BYTE_OFFSET: usize = MINT_LEN + EXTENSIONS_PADDING;
const EXTENSION_DATA_OFFSET: usize = TYPE_BYTE_OFFSET + EXTENSION_START_OFFSET;
const MINT_TYPE_BYTE: u8 = 1;

pub fn get_transfer_hook_authority(acc_data_bytes: &[u8]) -> Option<&Address> {
    let extension_data = get_extension_data_(acc_data_bytes, TRANSFER_HOOK_EXTENSION_TYPE);
    if let Some(data) = extension_data {
        return Some(unsafe { &*(data.as_ptr() as *const Address) });
    }
    None
}

fn get_extension_data_(acc_data_bytes: &[u8], extension_type: u16) -> Option<&[u8]> {
    let ext_bytes = &acc_data_bytes[EXTENSION_DATA_OFFSET..];
    let mut start = 0;
    let end = ext_bytes.len();
    while start < end {
        let ext_type_idx = start;
        let ext_len_idx = ext_type_idx + 2;
        let ext_data_idx = ext_len_idx + EXTENSION_LENGTH_LEN;

        let ext_type = unsafe { &*(ext_bytes[ext_type_idx..].as_ptr() as *const u16) };
        let ext_len = unsafe { &*(ext_bytes[ext_len_idx..].as_ptr() as *const u16) };

        if *ext_type == extension_type {
            return Some(&ext_bytes[ext_data_idx..ext_data_idx + *ext_len as usize]);
        }

        start = start + EXTENSION_TYPE_LEN + EXTENSION_LENGTH_LEN + *ext_len as usize;
    }
    None
}

pub fn has_immutable_owner_extension(acc_data_bytes: &[u8]) -> bool {
    let extension_data = get_extension_data_(acc_data_bytes, IMMUTABLE_OWNER_EXTENSION_TYPE);
    extension_data.is_some()
}

pub fn is_token_2022_mint(mint: &AccountView) -> bool {
    let data = unsafe { mint.borrow_unchecked() };
    let mint_type_byte = data[TYPE_BYTE_OFFSET];
    data.len() > TYPE_BYTE_OFFSET && mint_type_byte == MINT_TYPE_BYTE && mint.owned_by(&TOKEN_2022_PROGRAM_ID)
}
