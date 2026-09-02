mod read_price;

pub use read_price::*;

/// The Pyth Pull Oracle receiver program ID
/// (`rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ`). A genuine `PriceUpdateV2`
/// account is owned by this program, so the price reader checks the account's
/// owner before trusting its contents.
pub const PYTH_RECEIVER_PROGRAM_ID: pinocchio::Address =
    pinocchio::Address::from_str_const("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");
