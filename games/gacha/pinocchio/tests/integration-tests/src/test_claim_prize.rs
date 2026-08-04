use solana_address::Address;
use solana_instruction::{AccountMeta, Instruction};
use solana_keypair::Keypair;
use solana_signer::Signer;
use spl_token_2022_interface::{
    extension::{metadata_pointer::MetadataPointer, BaseStateWithExtensions, StateWithExtensions},
    state::{Account as TokenAccount, Mint},
};
use spl_token_metadata_interface::state::TokenMetadata;

use crate::{
    client,
    state::PullStatus,
    tests::{
        asserts::TransactionResultExt,
        constants::{PROGRAM_ID, TOKEN_2022_ID},
        pda::get_ata,
        utils::*,
    },
    GachaError, NFT_NAME_PREFIX, NFT_SYMBOL, NFT_URI, RARITY_LABELS,
};

#[test]
fn pending_pull_cannot_claim() {
    let (mut svm, admin) = setup();
    let operator = funded_keypair(&mut svm);
    let buyer = funded_keypair(&mut svm);
    init_pool(&mut svm, &admin, &operator.pubkey(), ENTRY_FEE, &[100]).assert_ok();

    let (result, pull, _) = buy_pull(&mut svm, &admin.pubkey(), &buyer);
    result.assert_ok();

    let payer = funded_keypair(&mut svm);
    claim_prize(&mut svm, &admin.pubkey(), &payer, &pull, &buyer.pubkey()).assert_err(GachaError::PullNotSettled);
}

#[test]
fn claim_mints_prize() {
    let (mut svm, admin) = setup();
    let operator = funded_keypair(&mut svm);
    let buyer = Keypair::new().pubkey();
    init_pool(&mut svm, &admin, &operator.pubkey(), ENTRY_FEE, &[70, 25, 5]).assert_ok();

    let tier = 2u8;
    let pull = set_settled_pull(&mut svm, &admin.pubkey(), &buyer, 0, tier);

    let payer = funded_keypair(&mut svm);
    claim_prize(&mut svm, &admin.pubkey(), &payer, &pull, &buyer).assert_ok();

    let (pool, _) = client::Pool::find_pda(&admin.pubkey());
    let (mint, _) = client::PrizeMint::find_pda(&pull);
    let mint_account = svm.get_account(&mint).expect("mint exists");
    assert_eq!(mint_account.owner, TOKEN_2022_ID);

    let mint_state = StateWithExtensions::<Mint>::unpack(&mint_account.data).expect("valid mint");
    assert_eq!(mint_state.base.decimals, 0);
    assert_eq!(mint_state.base.supply, 1);
    assert!(mint_state.base.mint_authority.is_none());

    let pointer = mint_state.get_extension::<MetadataPointer>().expect("metadata pointer");
    assert_eq!(pointer.metadata_address.0.to_bytes(), mint.to_bytes());
    assert_eq!(pointer.authority.0.to_bytes(), pool.to_bytes());

    let metadata = mint_state.get_variable_len_extension::<TokenMetadata>().expect("token metadata");
    assert_eq!(metadata.name, format!("{NFT_NAME_PREFIX}0"));
    assert_eq!(metadata.symbol, NFT_SYMBOL);
    assert_eq!(metadata.uri, NFT_URI);
    assert_eq!(metadata.mint.to_bytes(), mint.to_bytes());
    assert_eq!(metadata.update_authority.0.to_bytes(), pool.to_bytes());
    assert_eq!(metadata.additional_metadata, vec![("rarity".to_string(), RARITY_LABELS[tier as usize].to_string())]);
    assert_eq!(RARITY_LABELS[tier as usize], "rare");

    let ata_account = svm.get_account(&get_ata(&buyer, &mint)).expect("buyer ata exists");
    let ata_state = StateWithExtensions::<TokenAccount>::unpack(&ata_account.data).expect("valid token account");
    assert_eq!(ata_state.base.amount, 1);
    assert_eq!(ata_state.base.owner.to_bytes(), buyer.to_bytes());
    assert_eq!(ata_state.base.mint.to_bytes(), mint.to_bytes());

    let view = read_pull(&svm, &pull);
    assert_eq!(view.status, PullStatus::Claimed as u8);
    assert_eq!(view.tier_selected, tier);
}

#[test]
fn double_claim_rejected() {
    let (mut svm, admin) = setup();
    let operator = funded_keypair(&mut svm);
    let buyer = Keypair::new().pubkey();
    init_pool(&mut svm, &admin, &operator.pubkey(), ENTRY_FEE, &[100]).assert_ok();

    let pull = set_settled_pull(&mut svm, &admin.pubkey(), &buyer, 0, 0);

    let payer = funded_keypair(&mut svm);
    claim_prize(&mut svm, &admin.pubkey(), &payer, &pull, &buyer).assert_ok();
    claim_prize(&mut svm, &admin.pubkey(), &payer, &pull, &buyer).assert_err(GachaError::PullNotSettled);
}

#[test]
fn rejects_wrong_mint_pda() {
    let (mut svm, admin) = setup();
    let operator = funded_keypair(&mut svm);
    let buyer = Keypair::new().pubkey();
    init_pool(&mut svm, &admin, &operator.pubkey(), ENTRY_FEE, &[100]).assert_ok();

    let pull = set_settled_pull(&mut svm, &admin.pubkey(), &buyer, 0, 0);

    let payer = funded_keypair(&mut svm);
    let mut metas = claim_prize_metas(&admin.pubkey(), &payer.pubkey(), &pull, &buyer);
    metas[4] = AccountMeta::new(Address::new_unique(), false);
    let ix = Instruction { program_id: PROGRAM_ID, accounts: metas, data: vec![5u8] };
    build_and_send(&mut svm, &[&payer], &payer.pubkey(), &ix).assert_err(GachaError::InvalidMintPda);
}

#[test]
fn rejects_wrong_token_program() {
    let (mut svm, admin) = setup();
    let operator = funded_keypair(&mut svm);
    let buyer = Keypair::new().pubkey();
    init_pool(&mut svm, &admin, &operator.pubkey(), ENTRY_FEE, &[100]).assert_ok();

    let pull = set_settled_pull(&mut svm, &admin.pubkey(), &buyer, 0, 0);

    let payer = funded_keypair(&mut svm);
    let spl_token_v1 = Address::from_str_const("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
    let mut metas = claim_prize_metas(&admin.pubkey(), &payer.pubkey(), &pull, &buyer);
    metas[7] = AccountMeta::new_readonly(spl_token_v1, false);
    let ix = Instruction { program_id: PROGRAM_ID, accounts: metas, data: vec![5u8] };
    build_and_send(&mut svm, &[&payer], &payer.pubkey(), &ix).assert_err(GachaError::NotTokenProgram);
}
