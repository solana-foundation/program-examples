use {
    clap::{crate_description, crate_name, crate_version, Arg, Command},
    solana_clap_v3_utils::{
        input_parsers::{
            parse_url_or_moniker,
            signer::{SignerSource, SignerSourceParserBuilder},
        },
        input_validators::normalize_to_url_if_moniker,
        keypair::signer_from_path,
    },
    solana_client::nonblocking::rpc_client::RpcClient,
    solana_remote_wallet::remote_wallet::RemoteWalletManager,
    solana_sdk::{
        commitment_config::CommitmentConfig,
        message::Message,
        pubkey::Pubkey,
        signature::{Signature, Signer},
        transaction::Transaction,
    },
    spl_tlv_account_resolution::{account::ExtraAccountMeta, seeds::Seed, state::ExtraAccountMetaList},
    spl_transfer_hook_interface::instruction::ExecuteInstruction,
    std::{error::Error, process::exit, rc::Rc, sync::Arc},
};

struct Config {
    commitment_config: CommitmentConfig,
    payer: Arc<dyn Signer>,
    json_rpc_url: String,
    verbose: bool,
}

pub fn get_extra_account_metas_with_source_wallet_block() -> Vec<ExtraAccountMeta> {
    vec![
        // [5] wallet_block for source token account wallet
        ExtraAccountMeta::new_with_seeds(
            &[
                Seed::Literal { bytes: b"wallet_block".to_vec() },
                Seed::AccountData { account_index: 0, data_index: 32, length: 32 },
            ],
            false,
            false,
        )
        .unwrap(),
    ]
}
pub fn get_extra_account_metas_with_both_wallet_blocks() -> Vec<ExtraAccountMeta> {
    vec![
        // [5] wallet_block for source token account wallet
        ExtraAccountMeta::new_with_seeds(
            &[
                Seed::Literal { bytes: b"wallet_block".to_vec() },
                Seed::AccountData { account_index: 0, data_index: 32, length: 32 },
            ],
            false,
            false,
        )
        .unwrap(),
        // [6] wallet_block for destination token account wallet
        ExtraAccountMeta::new_with_seeds(
            &[
                Seed::Literal { bytes: b"wallet_block".to_vec() },
                Seed::AccountData { account_index: 2, data_index: 32, length: 32 },
            ],
            false,
            false,
        )
        .unwrap(),
    ]
}

fn create_empty_extra_metas() -> Vec<u8> {
    let size = ExtraAccountMetaList::size_of(0).unwrap();
    let metas: Vec<ExtraAccountMeta> = vec![];
    let mut data = vec![0; size];
    ExtraAccountMetaList::init::<ExecuteInstruction>(&mut data, &metas).unwrap();
    data
}

fn create_extra_metas_with_source_wallet_block() -> Vec<u8> {
    let metas: Vec<ExtraAccountMeta> = get_extra_account_metas_with_source_wallet_block();
    let size = ExtraAccountMetaList::size_of(metas.len()).unwrap();
    let mut data = vec![0; size];
    ExtraAccountMetaList::init::<ExecuteInstruction>(&mut data, &metas).unwrap();
    data
}
fn create_extra_metas_with_both_wallet_blocks() -> Vec<u8> {
    let metas: Vec<ExtraAccountMeta> = get_extra_account_metas_with_both_wallet_blocks();
    let size = ExtraAccountMetaList::size_of(metas.len()).unwrap();
    let mut data = vec![0; size];
    ExtraAccountMetaList::init::<ExecuteInstruction>(&mut data, &metas).unwrap();
    data
}

fn get_extra_metas_account_data() {
    let data_empty = create_empty_extra_metas();
    let data_source_wallet_block = create_extra_metas_with_source_wallet_block();
    let data_both_wallet_blocks = create_extra_metas_with_both_wallet_blocks();

    println!("data empty: {:?}", data_empty);
    println!("data source wallet block: {:?}", data_source_wallet_block);
    println!("data both wallet blocks: {:?}", data_both_wallet_blocks);
}

async fn get_config(rpc_client: &Arc<RpcClient>) {
    let config = block_list_client::accounts::Config::find_pda().0;
    let data = rpc_client.get_account_data(&config).await.unwrap();
    println!("config: {:?}", data);

    let config = block_list_client::accounts::Config::from_bytes(&data).unwrap();
    println!("config: {:?}", config);
}

async fn get_extra_metas(rpc_client: &Arc<RpcClient>, mint_address: &Pubkey) {
    let extra_metas = block_list_client::accounts::ExtraMetas::find_pda(mint_address).0;
    let data = rpc_client.get_account_data(&extra_metas).await.unwrap();
    println!("extra_metas: {:?}", data);
}

async fn process_setup_extra_metas(
    rpc_client: &Arc<RpcClient>,
    payer: &Arc<dyn Signer>,
    mint_address: &Pubkey,
    check_both_wallets: bool,
) -> Result<Signature, Box<dyn Error>> {
    let ix = block_list_client::instructions::SetupExtraMetasBuilder::new()
        .authority(payer.pubkey())
        .config(block_list_client::accounts::Config::find_pda().0)
        .mint(*mint_address)
        .extra_metas(block_list_client::accounts::ExtraMetas::find_pda(mint_address).0)
        .check_both_wallets(check_both_wallets)
        .instruction();

    let mut transaction = Transaction::new_unsigned(Message::new(&[ix], Some(&payer.pubkey())));

    let blockhash = rpc_client
        .get_latest_blockhash()
        .await
        .map_err(|err| format!("error: unable to get latest blockhash: {}", err))?;

    transaction.try_sign(&[payer], blockhash).map_err(|err| format!("error: failed to sign transaction: {}", err))?;

    let signature = rpc_client
        .send_and_confirm_transaction_with_spinner(&transaction)
        .await
        .map_err(|err| format!("error: send transaction: {}", err))?;

    Ok(signature)
}

async fn process_init(rpc_client: &Arc<RpcClient>, payer: &Arc<dyn Signer>) -> Result<Signature, Box<dyn Error>> {
    let ix = block_list_client::instructions::InitBuilder::new()
        .authority(payer.pubkey())
        .config(block_list_client::accounts::Config::find_pda().0)
        .instruction();

    let mut transaction = Transaction::new_unsigned(Message::new(&[ix], Some(&payer.pubkey())));

    let blockhash = rpc_client
        .get_latest_blockhash()
        .await
        .map_err(|err| format!("error: unable to get latest blockhash: {}", err))?;

    transaction.try_sign(&[payer], blockhash).map_err(|err| format!("error: failed to sign transaction: {}", err))?;

    let signature = rpc_client
        .send_and_confirm_transaction_with_spinner(&transaction)
        .await
        .map_err(|err| format!("error: send transaction: {}", err))?;

    Ok(signature)
}

async fn process_block_wallet(
    rpc_client: &Arc<RpcClient>,
    payer: &Arc<dyn Signer>,
    wallet_address: &Pubkey,
) -> Result<Signature, Box<dyn Error>> {
    let ix = block_list_client::instructions::BlockWalletBuilder::new()
        .authority(payer.pubkey())
        .config(block_list_client::accounts::Config::find_pda().0)
        .wallet(*wallet_address)
        .wallet_block(block_list_client::accounts::WalletBlock::find_pda(wallet_address).0)
        .instruction();

    let mut transaction = Transaction::new_unsigned(Message::new(&[ix], Some(&payer.pubkey())));

    let blockhash = rpc_client
        .get_latest_blockhash()
        .await
        .map_err(|err| format!("error: unable to get latest blockhash: {}", err))?;

    transaction.try_sign(&[payer], blockhash).map_err(|err| format!("error: failed to sign transaction: {}", err))?;

    let signature = rpc_client
        .send_and_confirm_transaction_with_spinner(&transaction)
        .await
        .map_err(|err| format!("error: send transaction: {}", err))?;

    Ok(signature)
}

async fn process_unblock_wallet(
    rpc_client: &Arc<RpcClient>,
    payer: &Arc<dyn Signer>,
    wallet_address: &Pubkey,
) -> Result<Signature, Box<dyn Error>> {
    let ix = block_list_client::instructions::UnblockWalletBuilder::new()
        .authority(payer.pubkey())
        .config(block_list_client::accounts::Config::find_pda().0)
        .wallet_block(block_list_client::accounts::WalletBlock::find_pda(wallet_address).0)
        .instruction();

    let mut transaction = Transaction::new_unsigned(Message::new(&[ix], Some(&payer.pubkey())));

    let blockhash = rpc_client
        .get_latest_blockhash()
        .await
        .map_err(|err| format!("error: unable to get latest blockhash: {}", err))?;

    transaction.try_sign(&[payer], blockhash).map_err(|err| format!("error: failed to sign transaction: {}", err))?;

    let signature = rpc_client
        .send_and_confirm_transaction_with_spinner(&transaction)
        .await
        .map_err(|err| format!("error: send transaction: {}", err))?;

    Ok(signature)
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    let app_matches = Command::new(crate_name!())
        .about(crate_description!())
        .version(crate_version!())
        .subcommand_required(true)
        .arg_required_else_help(true)
        .arg({
            let arg = Arg::new("config_file")
                .short('C')
                .long("config")
                .value_name("PATH")
                .takes_value(true)
                .global(true)
                .help("Configuration file to use");
            if let Some(ref config_file) = *solana_cli_config::CONFIG_FILE {
                arg.default_value(config_file)
            } else {
                arg
            }
        })
        .arg(
            Arg::new("payer")
                .long("payer")
                .value_name("KEYPAIR")
                .value_parser(SignerSourceParserBuilder::default().allow_all().build())
                .takes_value(true)
                .global(true)
                .help("Filepath or URL to a keypair [default: client keypair]"),
        )
        .arg(
            Arg::new("verbose")
                .long("verbose")
                .short('v')
                .takes_value(false)
                .global(true)
                .help("Show additional information"),
        )
        .arg(
            Arg::new("json_rpc_url")
                .short('u')
                .long("url")
                .value_name("URL")
                .takes_value(true)
                .global(true)
                .value_parser(parse_url_or_moniker)
                .help("JSON RPC URL for the cluster [default: value from configuration file]"),
        )
        .subcommand(Command::new("init").about("Initializes the blocklist"))
        .subcommand(
            Command::new("block-wallet").about("Blocks a wallet").arg(
                Arg::new("wallet_address")
                    .value_name("WALLET_ADDRESS")
                    .value_parser(SignerSourceParserBuilder::default().allow_pubkey().build())
                    .takes_value(true)
                    .index(1)
                    .help("Specify the wallet address to block"),
            ),
        )
        .subcommand(
            Command::new("unblock-wallet").about("Unblocks a wallet").arg(
                Arg::new("wallet_address")
                    .value_name("WALLET_ADDRESS")
                    .value_parser(SignerSourceParserBuilder::default().allow_pubkey().build())
                    .takes_value(true)
                    .index(1)
                    .help("Specify the wallet address to unblock"),
            ),
        )
        .subcommand(Command::new("get-extra-metas-account-data").about("Gets the extra metas account data"))
        .subcommand(Command::new("get-config").about("Gets the config account data"))
        .subcommand(
            Command::new("get-extra-metas").about("Gets the extra metas account data").arg(
                Arg::new("mint_address")
                    .value_name("MINT_ADDRESS")
                    .value_parser(SignerSourceParserBuilder::default().allow_pubkey().build())
                    .takes_value(true)
                    .index(1)
                    .help("Specify the mint address"),
            ),
        )
        .subcommand(
            Command::new("setup-extra-metas")
                .about("Setup the extra metas account")
                .arg(
                    Arg::new("mint_address")
                        .value_name("MINT_ADDRESS")
                        .value_parser(SignerSourceParserBuilder::default().allow_pubkey().build())
                        .takes_value(true)
                        .index(1)
                        .help("Specify the mint address"),
                )
                .arg(
                    Arg::new("check-both-wallets")
                        .long("check-both-wallets")
                        .short('b')
                        .help("Specify if both wallets should be checked"),
                ),
        )
        .get_matches();

    let (command, matches) = app_matches.subcommand().unwrap();
    let mut wallet_manager: Option<Rc<RemoteWalletManager>> = None;

    let config = {
        let cli_config = if let Some(config_file) = matches.try_get_one::<String>("config_file")? {
            solana_cli_config::Config::load(config_file).unwrap_or_default()
        } else {
            solana_cli_config::Config::default()
        };

        let payer = if let Ok(Some((signer, _))) = SignerSource::try_get_signer(matches, "payer", &mut wallet_manager) {
            Box::new(signer)
        } else {
            signer_from_path(matches, &cli_config.keypair_path, "payer", &mut wallet_manager)?
        };

        let json_rpc_url =
            normalize_to_url_if_moniker(matches.get_one::<String>("json_rpc_url").unwrap_or(&cli_config.json_rpc_url));

        Config {
            commitment_config: CommitmentConfig::confirmed(),
            payer: Arc::from(payer),
            json_rpc_url,
            verbose: matches.try_contains_id("verbose")?,
        }
    };
    solana_logger::setup_with_default("solana=info");

    if config.verbose {
        println!("JSON RPC URL: {}", config.json_rpc_url);
    }
    let rpc_client = Arc::new(RpcClient::new_with_commitment(config.json_rpc_url.clone(), config.commitment_config));

    match (command, matches) {
        ("init", _arg_matches) => {
            let response = process_init(&rpc_client, &config.payer).await.unwrap_or_else(|err| {
                eprintln!("error: init: {}", err);
                exit(1);
            });
            println!("{}", response);
        }
        ("block-wallet", arg_matches) => {
            let wallet_address =
                SignerSource::try_get_pubkey(arg_matches, "wallet_address", &mut wallet_manager).unwrap().unwrap();
            let response =
                process_block_wallet(&rpc_client, &config.payer, &wallet_address).await.unwrap_or_else(|err| {
                    eprintln!("error: init: {}", err);
                    exit(1);
                });
            println!("{}", response);
        }
        ("unblock-wallet", arg_matches) => {
            let wallet_address =
                SignerSource::try_get_pubkey(arg_matches, "wallet_address", &mut wallet_manager).unwrap().unwrap();
            let response =
                process_unblock_wallet(&rpc_client, &config.payer, &wallet_address).await.unwrap_or_else(|err| {
                    eprintln!("error: init: {}", err);
                    exit(1);
                });
            println!("{}", response);
        }
        ("get-extra-metas-account-data", _arg_matches) => {
            get_extra_metas_account_data();
        }
        ("get-config", _arg_matches) => {
            get_config(&rpc_client).await;
        }
        ("get-extra-metas", arg_matches) => {
            let mint_address =
                SignerSource::try_get_pubkey(arg_matches, "mint_address", &mut wallet_manager).unwrap().unwrap();
            get_extra_metas(&rpc_client, &mint_address).await;
        }
        ("setup-extra-metas", arg_matches) => {
            let mint_address =
                SignerSource::try_get_pubkey(arg_matches, "mint_address", &mut wallet_manager).unwrap().unwrap();
            let check_both_wallets = arg_matches.contains_id("check-both-wallets");
            let response = process_setup_extra_metas(&rpc_client, &config.payer, &mint_address, check_both_wallets)
                .await
                .unwrap_or_else(|err| {
                    eprintln!("error: setup_extra_metas: {}", err);
                    exit(1);
                });
            println!("{}", response);
        }
        _ => unreachable!(),
    };

    Ok(())
}
