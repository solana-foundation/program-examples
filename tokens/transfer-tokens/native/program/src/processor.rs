use {
    borsh::{BorshDeserialize, BorshSerialize},
    solana_program::{account_info::AccountInfo, entrypoint::ProgramResult, pubkey::Pubkey},
};

use crate::instructions::{
    create::{create_token, CreateTokenArgs},
    mint_nft::mint_nft,
    mint_spl::{mint_spl, MintSplArgs},
    transfer::{transfer_tokens, TransferTokensArgs},
};

#[derive(BorshSerialize, BorshDeserialize, Debug)]
enum MyInstruction {
    Create(CreateTokenArgs),
    MintNft,
    MintSpl(MintSplArgs),
    TransferTokens(TransferTokensArgs),
}

pub fn process_instruction(_program_id: &Pubkey, accounts: &[AccountInfo], instruction_data: &[u8]) -> ProgramResult {
    let instruction = MyInstruction::try_from_slice(instruction_data)?;

    match instruction {
        MyInstruction::Create(args) => create_token(accounts, args),
        MyInstruction::MintNft => mint_nft(accounts),
        MyInstruction::MintSpl(args) => mint_spl(accounts, args),
        MyInstruction::TransferTokens(args) => transfer_tokens(accounts, args),
    }
}
