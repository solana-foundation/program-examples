use {
    anchor_lang::{
        solana_program::{
            clock::Clock,
            instruction::{AccountMeta, Instruction},
            pubkey::Pubkey,
            system_program,
        },
        InstructionData, ToAccountMetas,
    },
    anchor_spl::{
        associated_token::{
            self, get_associated_token_address_with_program_id,
            spl_associated_token_account::instruction::create_associated_token_account,
        },
        token_2022::spl_token_2022::{
            self,
            extension::{
                transfer_fee::{TransferFeeAmount, TransferFeeConfig},
                BaseStateWithExtensions, StateWithExtensions,
            },
            state::{Account as TokenAccount, Mint},
        },
    },
    litesvm::LiteSVM,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

fn setup() -> (LiteSVM, Keypair) {
    let mut svm = LiteSVM::new();
    let bytes = include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/../../target/deploy/transfer_fee.so"));
    svm.add_program(transfer_fee::id(), bytes).unwrap();
    let payer = Keypair::new();
    svm.airdrop(&payer.pubkey(), 1_000_000_000).unwrap();
    (svm, payer)
}

fn send(svm: &mut LiteSVM, ixs: &[Instruction], payer: &Keypair, signers: &[&Keypair]) {
    let msg = Message::new_with_blockhash(ixs, Some(&payer.pubkey()), &svm.latest_blockhash());
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), signers).unwrap();
    svm.send_transaction(tx).unwrap();
    svm.expire_blockhash();
}

fn token_state(svm: &LiteSVM, token_account: &Pubkey) -> (u64, u64) {
    let account = svm.get_account(token_account).unwrap();
    let state = StateWithExtensions::<TokenAccount>::unpack(&account.data).unwrap();
    let withheld = state.get_extension::<TransferFeeAmount>().unwrap().withheld_amount;
    (state.base.amount, withheld.into())
}

fn fee_config(svm: &LiteSVM, mint: &Pubkey) -> TransferFeeConfig {
    let account = svm.get_account(mint).unwrap();
    let state = StateWithExtensions::<Mint>::unpack(&account.data).unwrap();
    *state.get_extension::<TransferFeeConfig>().unwrap()
}

fn transfer(
    payer: &Keypair,
    recipient: &Pubkey,
    mint: &Pubkey,
    sender_ata: &Pubkey,
    recipient_ata: &Pubkey,
    amount: u64,
) -> Instruction {
    Instruction::new_with_bytes(
        transfer_fee::id(),
        &transfer_fee::instruction::Transfer { amount }.data(),
        transfer_fee::accounts::Transfer {
            sender: payer.pubkey(),
            recipient: *recipient,
            mint_account: *mint,
            sender_token_account: *sender_ata,
            recipient_token_account: *recipient_ata,
            token_program: spl_token_2022::ID,
            associated_token_program: associated_token::ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    )
}

#[test]
fn transfer_harvest_withdraw_and_update_fee() {
    let (mut svm, payer) = setup();
    let mint = Keypair::new();
    let recipient = Keypair::new();
    let sender_ata = get_associated_token_address_with_program_id(&payer.pubkey(), &mint.pubkey(), &spl_token_2022::ID);
    let recipient_ata =
        get_associated_token_address_with_program_id(&recipient.pubkey(), &mint.pubkey(), &spl_token_2022::ID);

    let initialize = Instruction::new_with_bytes(
        transfer_fee::id(),
        &transfer_fee::instruction::Initialize { transfer_fee_basis_points: 100, maximum_fee: 1 }.data(),
        transfer_fee::accounts::Initialize {
            payer: payer.pubkey(),
            mint_account: mint.pubkey(),
            token_program: spl_token_2022::ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    send(&mut svm, &[initialize], &payer, &[&payer, &mint]);
    let config = fee_config(&svm, &mint.pubkey());
    assert_eq!(Option::<Pubkey>::from(config.transfer_fee_config_authority), Some(payer.pubkey()));
    assert_eq!(Option::<Pubkey>::from(config.withdraw_withheld_authority), Some(payer.pubkey()));
    assert_eq!(u64::from(config.withheld_amount), 0);
    assert_eq!(u16::from(config.newer_transfer_fee.transfer_fee_basis_points), 100);
    assert_eq!(u64::from(config.newer_transfer_fee.maximum_fee), 1);
    assert_eq!(u16::from(config.older_transfer_fee.transfer_fee_basis_points), 100);
    assert_eq!(u64::from(config.older_transfer_fee.maximum_fee), 1);

    let mint_tokens = [
        create_associated_token_account(&payer.pubkey(), &payer.pubkey(), &mint.pubkey(), &spl_token_2022::ID),
        spl_token_2022::instruction::mint_to(
            &spl_token_2022::ID,
            &mint.pubkey(),
            &sender_ata,
            &payer.pubkey(),
            &[],
            300,
        )
        .unwrap(),
    ];
    send(&mut svm, &mint_tokens, &payer, &[&payer]);
    assert_eq!(token_state(&svm, &sender_ata), (300, 0));

    let ix = transfer(&payer, &recipient.pubkey(), &mint.pubkey(), &sender_ata, &recipient_ata, 100);
    send(&mut svm, &[ix], &payer, &[&payer]);
    assert_eq!(token_state(&svm, &sender_ata), (200, 0));
    assert_eq!(token_state(&svm, &recipient_ata), (99, 1));

    let ix = transfer(&payer, &recipient.pubkey(), &mint.pubkey(), &sender_ata, &recipient_ata, 200);
    send(&mut svm, &[ix], &payer, &[&payer]);
    assert_eq!(token_state(&svm, &sender_ata), (0, 0));
    assert_eq!(token_state(&svm, &recipient_ata), (298, 2));

    let mut harvest_metas =
        transfer_fee::accounts::Harvest { mint_account: mint.pubkey(), token_program: spl_token_2022::ID }
            .to_account_metas(None);
    harvest_metas.push(AccountMeta::new(recipient_ata, false));
    let harvest =
        Instruction::new_with_bytes(transfer_fee::id(), &transfer_fee::instruction::Harvest {}.data(), harvest_metas);
    send(&mut svm, &[harvest], &payer, &[&payer]);
    assert_eq!(token_state(&svm, &recipient_ata), (298, 0));
    assert_eq!(u64::from(fee_config(&svm, &mint.pubkey()).withheld_amount), 2);

    let withdraw = Instruction::new_with_bytes(
        transfer_fee::id(),
        &transfer_fee::instruction::Withdraw {}.data(),
        transfer_fee::accounts::Withdraw {
            authority: payer.pubkey(),
            mint_account: mint.pubkey(),
            token_account: sender_ata,
            token_program: spl_token_2022::ID,
        }
        .to_account_metas(None),
    );
    send(&mut svm, &[withdraw], &payer, &[&payer]);
    assert_eq!(token_state(&svm, &sender_ata), (2, 0));
    assert_eq!(u64::from(fee_config(&svm, &mint.pubkey()).withheld_amount), 0);

    let update_fee = Instruction::new_with_bytes(
        transfer_fee::id(),
        &transfer_fee::instruction::UpdateFee { transfer_fee_basis_points: 0, maximum_fee: 0 }.data(),
        transfer_fee::accounts::UpdateFee {
            authority: payer.pubkey(),
            mint_account: mint.pubkey(),
            token_program: spl_token_2022::ID,
        }
        .to_account_metas(None),
    );
    let epoch = svm.get_sysvar::<Clock>().epoch;
    send(&mut svm, &[update_fee], &payer, &[&payer]);
    // The new fee is scheduled two epochs out; the old one stays in force until then.
    let config = fee_config(&svm, &mint.pubkey());
    assert_eq!(u16::from(config.newer_transfer_fee.transfer_fee_basis_points), 0);
    assert_eq!(u64::from(config.newer_transfer_fee.maximum_fee), 0);
    assert_eq!(u64::from(config.newer_transfer_fee.epoch), epoch + 2);
    assert_eq!(u16::from(config.older_transfer_fee.transfer_fee_basis_points), 100);
    assert_eq!(u64::from(config.older_transfer_fee.maximum_fee), 1);
}
