use solana_address::Address;
use solana_instruction::{AccountMeta, Instruction};
use solana_signer::Signer;
use spl_token_2022_interface::{
    extension::{metadata_pointer::MetadataPointer, BaseStateWithExtensions, StateWithExtensions},
    state::{Account as TokenAccount, Mint},
};
use spl_token_metadata_interface::state::TokenMetadata;

use crate::{
    client,
    gacha::{format_hex, select_tier},
    tests::{
        asserts::TransactionResultExt,
        constants::{PROGRAM_ID, TOKEN_2022_ID},
        pda::get_ata,
        utils::*,
    },
    GachaError, Pull, MAX_TIERS, NFT_NAME_PREFIX, NFT_SYMBOL, NFT_URI, RARITY_LABELS,
};

fn hex(bytes: &[u8]) -> String {
    let mut buf = vec![0u8; bytes.len() * 2];
    format_hex(bytes, &mut buf).to_string()
}

fn unhex(s: &str) -> Vec<u8> {
    (0..s.len() / 2).map(|i| u8::from_str_radix(&s[2 * i..2 * i + 2], 16).unwrap()).collect()
}

/// An arbitrary proof: the program never verifies it on-chain, it only records it.
fn test_proof() -> [u8; 80] {
    let mut proof = [0u8; 80];
    for (i, byte) in proof.iter_mut().enumerate() {
        *byte = i as u8;
    }
    proof
}

#[test]
fn settle_mints_self_certifying_prize_and_closes_pull() {
    let (mut svm, admin) = setup();
    let operator = funded_keypair(&mut svm);
    let buyer = funded_keypair(&mut svm);
    let weights = [70u32, 25, 5];
    init_pool(&mut svm, &admin, &operator.pubkey(), ENTRY_FEE, &weights).assert_ok();

    let (result, pull, client_seed) = buy_pull(&mut svm, &admin.pubkey(), &buyer);
    result.assert_ok();

    // 95 % 100 = 95 -> past 70 and 25 -> tier 2 ("rare").
    let beta = beta_from(95);
    let proof = test_proof();
    let expected_tier = 2u8;

    let pull_rent = svm.get_account(&pull).expect("pull exists").lamports;
    let buyer_before = svm.get_balance(&buyer.pubkey()).unwrap();

    settle_and_distribute(&mut svm, &admin.pubkey(), &operator, &pull, &buyer.pubkey(), &beta, &proof).assert_ok();

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
    assert_eq!(
        metadata.additional_metadata,
        vec![
            ("rarity".to_string(), RARITY_LABELS[expected_tier as usize].to_string()),
            ("pull".to_string(), hex(pull.as_ref())),
            ("client_seed".to_string(), hex(&client_seed)),
            ("beta".to_string(), hex(&beta)),
            ("proof".to_string(), hex(&proof)),
        ]
    );

    // The NFT is self-certifying: replay the whole verification from metadata alone.
    let fields: std::collections::HashMap<_, _> = metadata.additional_metadata.iter().cloned().collect();
    let pull_bytes = unhex(&fields["pull"]);
    let seed_bytes = unhex(&fields["client_seed"]);
    let alpha = solana_sha256_hasher::hashv(&[&pull_bytes, &seed_bytes]).to_bytes();
    assert_eq!(alpha, solana_sha256_hasher::hashv(&[pull.as_ref(), &client_seed]).to_bytes());
    let beta_bytes: [u8; 64] = unhex(&fields["beta"]).try_into().unwrap();
    let mut padded = [0u32; MAX_TIERS];
    padded[..weights.len()].copy_from_slice(&weights);
    let tier = select_tier(&beta_bytes, &padded, weights.len() as u8).unwrap();
    assert_eq!(RARITY_LABELS[tier as usize], fields["rarity"]);

    let ata_account = svm.get_account(&get_ata(&buyer.pubkey(), &mint)).expect("buyer ata exists");
    let ata_state = StateWithExtensions::<TokenAccount>::unpack(&ata_account.data).expect("valid token account");
    assert_eq!(ata_state.base.amount, 1);
    assert_eq!(ata_state.base.owner.to_bytes(), buyer.pubkey().to_bytes());

    let closed = svm.get_account(&pull);
    assert!(closed.is_none_or(|a| a.lamports == 0), "pull account should be closed");
    let buyer_after = svm.get_balance(&buyer.pubkey()).unwrap();
    assert_eq!(buyer_after - buyer_before, pull_rent, "pull rent refunds to the buyer");

    let pool_view = read_pool(&svm, &admin.pubkey());
    assert_eq!(pool_view.pending_pulls, 0);
    assert_eq!(pool_view.pulls_count, 1);
}

#[test]
fn settled_fee_becomes_withdrawable() {
    let (mut svm, admin) = setup();
    let operator = funded_keypair(&mut svm);
    let buyer = funded_keypair(&mut svm);
    init_pool(&mut svm, &admin, &operator.pubkey(), ENTRY_FEE, &[100]).assert_ok();

    let (result, pull, _) = buy_pull(&mut svm, &admin.pubkey(), &buyer);
    result.assert_ok();

    withdraw_fees(&mut svm, &admin.pubkey(), &admin, ENTRY_FEE).assert_err(GachaError::InsufficientVaultFunds);

    settle_and_distribute(&mut svm, &admin.pubkey(), &operator, &pull, &buyer.pubkey(), &beta_from(0), &test_proof())
        .assert_ok();

    withdraw_fees(&mut svm, &admin.pubkey(), &admin, ENTRY_FEE).assert_ok();
}

#[test]
fn double_settle_rejected() {
    let (mut svm, admin) = setup();
    let operator = funded_keypair(&mut svm);
    let buyer = funded_keypair(&mut svm);
    init_pool(&mut svm, &admin, &operator.pubkey(), ENTRY_FEE, &[100]).assert_ok();

    let (result, pull, _) = buy_pull(&mut svm, &admin.pubkey(), &buyer);
    result.assert_ok();

    settle_and_distribute(&mut svm, &admin.pubkey(), &operator, &pull, &buyer.pubkey(), &beta_from(0), &test_proof())
        .assert_ok();
    settle_and_distribute(&mut svm, &admin.pubkey(), &operator, &pull, &buyer.pubkey(), &beta_from(1), &test_proof())
        .assert_err(GachaError::NotProgramOwned);
}

#[test]
fn non_operator_cannot_settle() {
    let (mut svm, admin) = setup();
    let operator = funded_keypair(&mut svm);
    let buyer = funded_keypair(&mut svm);
    init_pool(&mut svm, &admin, &operator.pubkey(), ENTRY_FEE, &[100]).assert_ok();

    let (result, pull, _) = buy_pull(&mut svm, &admin.pubkey(), &buyer);
    result.assert_ok();

    let impostor = funded_keypair(&mut svm);
    settle_and_distribute(&mut svm, &admin.pubkey(), &impostor, &pull, &buyer.pubkey(), &beta_from(0), &test_proof())
        .assert_err(GachaError::NotOperator);
}

#[test]
fn rejects_wrong_buyer() {
    let (mut svm, admin) = setup();
    let operator = funded_keypair(&mut svm);
    let buyer = funded_keypair(&mut svm);
    init_pool(&mut svm, &admin, &operator.pubkey(), ENTRY_FEE, &[100]).assert_ok();

    let (result, pull, _) = buy_pull(&mut svm, &admin.pubkey(), &buyer);
    result.assert_ok();

    let impostor = funded_keypair(&mut svm);
    settle_and_distribute(
        &mut svm,
        &admin.pubkey(),
        &operator,
        &pull,
        &impostor.pubkey(),
        &beta_from(0),
        &test_proof(),
    )
    .assert_err(GachaError::BuyerMismatch);
}

#[test]
fn rejects_wrong_mint_pda() {
    let (mut svm, admin) = setup();
    let operator = funded_keypair(&mut svm);
    let buyer = funded_keypair(&mut svm);
    init_pool(&mut svm, &admin, &operator.pubkey(), ENTRY_FEE, &[100]).assert_ok();

    let (result, pull, _) = buy_pull(&mut svm, &admin.pubkey(), &buyer);
    result.assert_ok();

    let mut metas = settle_metas(&admin.pubkey(), &operator.pubkey(), &pull, &buyer.pubkey());
    metas[4] = AccountMeta::new(Address::new_unique(), false);
    let ix = Instruction { program_id: PROGRAM_ID, accounts: metas, data: settle_data(&beta_from(0), &test_proof()) };
    build_and_send(&mut svm, &[&operator], &operator.pubkey(), &ix).assert_err(GachaError::InvalidMintPda);
}

#[test]
fn rejects_wrong_token_program() {
    let (mut svm, admin) = setup();
    let operator = funded_keypair(&mut svm);
    let buyer = funded_keypair(&mut svm);
    init_pool(&mut svm, &admin, &operator.pubkey(), ENTRY_FEE, &[100]).assert_ok();

    let (result, pull, _) = buy_pull(&mut svm, &admin.pubkey(), &buyer);
    result.assert_ok();

    let spl_token_v1 = Address::from_str_const("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
    let mut metas = settle_metas(&admin.pubkey(), &operator.pubkey(), &pull, &buyer.pubkey());
    metas[7] = AccountMeta::new_readonly(spl_token_v1, false);
    let ix = Instruction { program_id: PROGRAM_ID, accounts: metas, data: settle_data(&beta_from(0), &test_proof()) };
    build_and_send(&mut svm, &[&operator], &operator.pubkey(), &ix).assert_err(GachaError::NotTokenProgram);
}

#[test]
fn rejects_pull_from_other_pool() {
    let (mut svm, admin_a) = setup();
    let admin_b = funded_keypair(&mut svm);
    let operator = funded_keypair(&mut svm);
    let buyer = funded_keypair(&mut svm);
    init_pool(&mut svm, &admin_a, &operator.pubkey(), ENTRY_FEE, &[100]).assert_ok();
    init_pool(&mut svm, &admin_b, &operator.pubkey(), ENTRY_FEE, &[100]).assert_ok();

    let (result, pull_a, _) = buy_pull(&mut svm, &admin_a.pubkey(), &buyer);
    result.assert_ok();

    settle_and_distribute(
        &mut svm,
        &admin_b.pubkey(),
        &operator,
        &pull_a,
        &buyer.pubkey(),
        &beta_from(0),
        &test_proof(),
    )
    .assert_err(GachaError::PoolMismatch);
}

#[test]
fn settle_after_refund_rejected() {
    let (mut svm, admin) = setup();
    let operator = funded_keypair(&mut svm);
    let buyer = funded_keypair(&mut svm);
    init_pool(&mut svm, &admin, &operator.pubkey(), ENTRY_FEE, &[100]).assert_ok();

    let (result, pull, _) = buy_pull(&mut svm, &admin.pubkey(), &buyer);
    result.assert_ok();

    let requested_slot = read_pull(&svm, &pull).requested_slot;
    svm.warp_to_slot(requested_slot + SETTLE_DEADLINE + 2);
    refund_pull(&mut svm, &admin.pubkey(), &buyer, &pull).assert_ok();

    settle_and_distribute(&mut svm, &admin.pubkey(), &operator, &pull, &buyer.pubkey(), &beta_from(0), &test_proof())
        .assert_err(GachaError::NotProgramOwned);
}

#[test]
fn each_tier_is_reachable() {
    let (mut svm, admin) = setup();
    let operator = funded_keypair(&mut svm);
    let buyer = funded_keypair(&mut svm);
    let weights = [70u32, 25, 5];
    init_pool(&mut svm, &admin, &operator.pubkey(), ENTRY_FEE, &weights).assert_ok();

    for (target, expected_rarity) in [(0u128, "common"), (70, "uncommon"), (95, "rare")] {
        let (result, pull, _) = buy_pull(&mut svm, &admin.pubkey(), &buyer);
        result.assert_ok();
        settle_and_distribute(
            &mut svm,
            &admin.pubkey(),
            &operator,
            &pull,
            &buyer.pubkey(),
            &beta_from(target),
            &test_proof(),
        )
        .assert_ok();

        let (mint, _) = client::PrizeMint::find_pda(&pull);
        let mint_account = svm.get_account(&mint).expect("mint exists");
        let mint_state = StateWithExtensions::<Mint>::unpack(&mint_account.data).expect("valid mint");
        let metadata = mint_state.get_variable_len_extension::<TokenMetadata>().expect("token metadata");
        let rarity = metadata.additional_metadata.iter().find(|(k, _)| k == "rarity").map(|(_, v)| v.clone());
        assert_eq!(rarity.as_deref(), Some(expected_rarity));
    }
}

#[test]
fn operator_pays_mint_rent_and_pull_never_stores_beta() {
    let (mut svm, admin) = setup();
    let operator = funded_keypair(&mut svm);
    let buyer = funded_keypair(&mut svm);
    init_pool(&mut svm, &admin, &operator.pubkey(), ENTRY_FEE, &[100]).assert_ok();

    let (result, pull, _) = buy_pull(&mut svm, &admin.pubkey(), &buyer);
    result.assert_ok();
    let pull_account = svm.get_account(&pull).expect("pull exists");
    assert_eq!(pull_account.data.len(), Pull::LEN);

    let operator_before = svm.get_balance(&operator.pubkey()).unwrap();
    settle_and_distribute(&mut svm, &admin.pubkey(), &operator, &pull, &buyer.pubkey(), &beta_from(0), &test_proof())
        .assert_ok();
    let operator_after = svm.get_balance(&operator.pubkey()).unwrap();

    let (mint, _) = client::PrizeMint::find_pda(&pull);
    let mint_rent = svm.get_account(&mint).expect("mint exists").lamports;
    let ata_rent = svm.get_account(&get_ata(&buyer.pubkey(), &mint)).expect("ata exists").lamports;
    assert_eq!(operator_before - operator_after, mint_rent + ata_rent + TX_FEE);
}
