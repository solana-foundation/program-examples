# NFT Operations

This example demonstrates how to create a NFT collection, how to mint a NFT and how to verify a NFT as part of a collection.

---

## Program Setup

For this program example we will be cloning the Metaplex Token Metadata program from mainnet. You can find this in the Anchor.toml file

```rust
[test.validator]
url = "https://api.mainnet-beta.solana.com"

[[test.validator.clone]]
address = "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
```

We will need this program to perform CPIs to create the Metadata Accounts, Master Edition Accounts and to Verify NFTs as part of collections

---

## Create a NFT Collection:

The accounts needed to create a NFT Collection are the following:

```rust
#[derive(Accounts)]
pub struct CreateCollection<'info> {
    #[account(mut)]
    user: Signer<'info>,
    #[account(
        init,
        payer = user,
        mint::decimals = 0,
        mint::authority = mint_authority,
        mint::freeze_authority = mint_authority,
    )]
    mint: Account<'info, Mint>,
    #[account(
        seeds = [b"authority"],
        bump,
    )]
    /// CHECK: This account is not initialized and is being used for signing purposes only
    pub mint_authority: UncheckedAccount<'info>,
    #[account(mut)]
    /// CHECK: This account will be initialized by the metaplex program
    metadata: UncheckedAccount<'info>,
    #[account(mut)]
    /// CHECK: This account will be initialized by the metaplex program
    master_edition: UncheckedAccount<'info>,
    #[account(
        init,
        payer = user,
        associated_token::mint = mint,
        associated_token::authority = user
    )]
    destination: Account<'info, TokenAccount>,
    system_program: Program<'info, System>,
    token_program: Program<'info, Token>,
    associated_token_program: Program<'info, AssociatedToken>,
    token_metadata_program: Program<'info, Metadata>,
}
```

### Let's break down these accounts:

- user: the account that is creating the collection NFT and the owner of the destination token account

- mint: the collection NFT Mint account. We will be initializing this account with 0 decimals and giving the mint authority and freeze authority to the mint_authority account

- mint_authority: the account with authority to mint tokens from the collection NFT mint account

- metadata: the metadata account of the collection NFT

- master_edition: the master edition account of the collection NFT

- destination: the token account where the collection NFT will minted to. We will be initializing this account and verifying the correct mint and authority

- system_program: Program resposible for the initialization of any new account

- token_program and associated_token_program: We are creating new ATAs and minting tokens

- token_metadata_program: MPL token metadata program that will be used to create the metadata and master edition accounts

To note in here, that both the metadata account and the master_edition account are Unchecked Accounts. That is due to the fact that they are not initialized, and the initialization will be performed by the token_metadata_program when we perform a CPI (cross program invocation) to initialize both accounts.

If we had something like:

```rust
#[derive(Accounts)]
pub struct CreateCollection<'info> {
    #[account(mut)]
    metadata: Account<'info, MetadataAccount>,
    #[account(mut)]
    master_edition: Account<'info, MasterEditionAccount>,
}
```

our instruction would fail because it would expect the accounts to be already initialized.

However, if the account was already initialized (you'll see that while we verify collections), you should use the specific account types

### We then implement some functionality for our CreateCollection context:

```rust
impl<'info> CreateCollection<'info> {
    pub fn create_collection(&mut self, bumps: &CreateCollectionBumps) -> Result<()> {

        let metadata = &self.metadata.to_account_info();
        let master_edition = &self.master_edition.to_account_info();
        let mint = &self.mint.to_account_info();
        let authority = &self.mint_authority.to_account_info();
        let payer = &self.user.to_account_info();
        let system_program = &self.system_program.to_account_info();
        let spl_token_program = &self.token_program.to_account_info();
        let spl_metadata_program = &self.token_metadata_program.to_account_info();

        let seeds = &[
            &b"authority"[..],
            &[bumps.mint_authority]
        ];
        let signer_seeds = &[&seeds[..]];

        let cpi_program = self.token_program.to_account_info();
        let cpi_accounts = MintTo {
            mint: self.mint.to_account_info(),
            to: self.destination.to_account_info(),
            authority: self.mint_authority.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);
        mint_to(cpi_ctx, 1)?;
        msg!("Collection NFT minted!");

        let creator = vec![
            Creator {
                address: self.mint_authority.key().clone(),
                verified: true,
                share: 100,
            },
        ];

        let metadata_account = CreateMetadataAccountV3Cpi::new(
            spl_metadata_program,
            CreateMetadataAccountV3CpiAccounts {
                metadata,
                mint,
                mint_authority: authority,
                payer,
                update_authority: (authority, true),
                system_program,
                rent: None,
            },
            CreateMetadataAccountV3InstructionArgs {
                data: DataV2 {
                    name: "DummyCollection".to_owned(),
                    symbol: "DC".to_owned(),
                    uri: "".to_owned(),
                    seller_fee_basis_points: 0,
                    creators: Some(creator),
                    collection: None,
                    uses: None,
                },
                is_mutable: true,
                collection_details: Some(
                    CollectionDetails::V1 {
                        size: 0
                    }
                )
            }
        );
        metadata_account.invoke_signed(signer_seeds)?;
        msg!("Metadata Account created!");

        let master_edition_account = CreateMasterEditionV3Cpi::new(
            spl_metadata_program,
            CreateMasterEditionV3CpiAccounts {
                edition: master_edition,
                update_authority: authority,
                mint_authority: authority,
                mint,
                payer,
                metadata,
                token_program: spl_token_program,
                system_program,
                rent: None,
            },
            CreateMasterEditionV3InstructionArgs {
                max_supply: Some(0),
            }
        );
        master_edition_account.invoke_signed(signer_seeds)?;
        msg!("Master Edition Account created");

        Ok(())
    }
}
```

The create collection method consists of 3 steps:

- Mint one token to the destination token account by performing a CPI to the Token Program

- Create a metadata account for the mint account to store standardized data that can be understood by apps and marketplaces. This is achieved by performing a CPI to the Token Metadata Program. The mint authority needs to sign that CPI, therefore we use "invoke_signed" and pass in the seeds of our authority PDA

- Create a master edition account for the mint account by performing a CPI to the Token Metadata Program. That will ensure that the special characteristics on Non-Fungible Tokens are met. It will also transfer both the mint authority and the freeze authority to the Master Edition PDA. The mint authority needs to sign that CPI, therefore we use "invoke_signed" and pass in the seeds of our authority PDA

More information on Token Metadata can be found at https://developers.metaplex.com/token-metadata

---

## Mint a NFT:

The accounts needed to create a NFT Collection are the following:

```rust
#[derive(Accounts)]
pub struct MintNFT<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        init,
        payer = owner,
        mint::decimals = 0,
        mint::authority = mint_authority,
        mint::freeze_authority = mint_authority,
    )]
    pub mint: Account<'info, Mint>,
    #[account(
        init,
        payer = owner,
        associated_token::mint = mint,
        associated_token::authority = owner
    )]
    pub destination: Account<'info, TokenAccount>,
    #[account(mut)]
    /// CHECK: This account will be initialized by the metaplex program
    pub metadata: UncheckedAccount<'info>,
    #[account(mut)]
    /// CHECK: This account will be initialized by the metaplex program
    pub master_edition: UncheckedAccount<'info>,
    #[account(
        seeds = [b"authority"],
        bump,
    )]
    /// CHECK: This is account is not initialized and is being used for signing purposes only
    pub mint_authority: UncheckedAccount<'info>,
    #[account(mut)]
    pub collection_mint: Account<'info, Mint>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_metadata_program: Program<'info, Metadata>,
}
```

### Let's break down these accounts:

- owner: the account that is creating the NFT and the owner of the destination token account

- mint: the collection NFT Mint account. We will be initializing this account with 0 decimals and giving the mint authority and freeze authority to the mint_authority account

- destination: the token account where the collection NFT will minted to. We will be initializing this account and verifying the correct mint and authority

- metadata: the metadata account of the collection NFT

- master_edition: the master edition account of the collection NFT

- mint_authority: the account with authority to mint tokens from the collection NFT mint account

- collection_mint: the collection account that the NFT that we are minting should be part of

- system_program: Program resposible for the initialization of any new account

- token_program and associated_token_program: We are creating new ATAs and minting tokens

- token_metadata_program: MPL token metadata program that will be used to create the metadata and master edition accounts

If you take a closer look, you will see that the accounts (apart from "collection_mint") are the same.
This is due to the fact that the a collection is basically just a regular NFT but, the "collection_details" field will be set with a CollectionDetails struct and the "collection" field under "data" set to None.

On the other hand, a NFT will have "collection_details" field set to None and with a CollectionDetails and the "collection" field under "data" set to a Collection struct, containing the key of the collection it belongs to and a verified boolean (set to False, it will be automatically set to True once the NFT gets verified as part of the collection)

This is actually where the "collection" account comes from. This account is used to set the the address of the Collection struct when we are creating the NFT metadata account

### We then implement some functionality for our MintNFT context:

```rust
impl<'info> MintNFT<'info> {
    pub fn mint_nft(&mut self, bumps: &MintNFTBumps) -> Result<()> {

        let metadata = &self.metadata.to_account_info();
        let master_edition = &self.master_edition.to_account_info();
        let mint = &self.mint.to_account_info();
        let authority = &self.mint_authority.to_account_info();
        let payer = &self.owner.to_account_info();
        let system_program = &self.system_program.to_account_info();
        let spl_token_program = &self.token_program.to_account_info();
        let spl_metadata_program = &self.token_metadata_program.to_account_info();

        let seeds = &[
            &b"authority"[..],
            &[bumps.mint_authority]
        ];
        let signer_seeds = &[&seeds[..]];

        let cpi_program = self.token_program.to_account_info();
        let cpi_accounts = MintTo {
            mint: self.mint.to_account_info(),
            to: self.destination.to_account_info(),
            authority: self.mint_authority.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);
        mint_to(cpi_ctx, 1)?;
        msg!("Collection NFT minted!");

        let creator = vec![
            Creator {
                address: self.mint_authority.key(),
                verified: true,
                share: 100,
            },
        ];

        let metadata_account = CreateMetadataAccountV3Cpi::new(
            spl_metadata_program,
            CreateMetadataAccountV3CpiAccounts {
                metadata,
                mint,
                mint_authority: authority,
                payer,
                update_authority: (authority, true),
                system_program,
                rent: None,
            },
            CreateMetadataAccountV3InstructionArgs {
                data: DataV2 {
                    name: "Mint Test".to_string(),
                    symbol: "YAY".to_string(),
                    uri: "".to_string(),
                    seller_fee_basis_points: 0,
                    creators: Some(creator),
                    collection: Some(Collection {
                        verified: false,
                        key: self.collection_mint.key(),
                    }),
                    uses: None
                },
                is_mutable: true,
                collection_details: None,
            }
        );
        metadata_account.invoke_signed(signer_seeds)?;

        let master_edition_account = CreateMasterEditionV3Cpi::new(
            spl_metadata_program,
            CreateMasterEditionV3CpiAccounts {
                edition: master_edition,
                update_authority: authority,
                mint_authority: authority,
                mint,
                payer,
                metadata,
                token_program: spl_token_program,
                system_program,
                rent: None,
            },
            CreateMasterEditionV3InstructionArgs {
                max_supply: Some(0),
            }
        );
        master_edition_account.invoke_signed(signer_seeds)?;

        Ok(())

    }
}
```

Since a collection NFT is just a regular NFT with "special" metadata, again you can see that the same is happening as when created the Collection NFT.

- Mint one token to the destination token account by performing a CPI to the Token Program

- Create a metadata account for the mint account to store standardized data that can be understood by apps and marketplaces. This is achieved by performing a CPI to the Token Metadata Program. The mint authority needs to sign that CPI, therefore we use "invoke_signed" and pass in the seeds of our authority PDA

- Create a master edition account for the mint account by performing a CPI to the Token Metadata Program. That will ensure that the special characteristics on Non-Fungible Tokens are met. It will also transfer both the mint authority and the freeze authority to the Master Edition PDA. The mint authority needs to sign that CPI, therefore we use "invoke_signed" and pass in the seeds of our authority PDA

The difference is in the data of our metadata account.

for our collection NFT, we have

```rust
CreateMetadataAccountV3InstructionArgs {
    data: DataV2 {
        name: "DummyCollection".to_owned(),
        symbol: "DC".to_owned(),
        uri: "".to_owned(),
        seller_fee_basis_points: 0,
        creators: Some(creator),
        collection: None,
        uses: None,
    },
    is_mutable: true,
    collection_details: Some(
        CollectionDetails::V1 {
            size: 0
        }
    )
}
```

where we set the "collection_details" field

for our "regular" NFT we have

```rust
CreateMetadataAccountV3InstructionArgs {
    data: DataV2 {
        name: "Mint Test".to_string(),
        symbol: "YAY".to_string(),
        uri: "".to_string(),
        seller_fee_basis_points: 0,
        creators: Some(creator),
        collection: Some(Collection {
            verified: false,
            key: self.collection_mint.key(),
        }),
        uses: None
    },
    is_mutable: true,
    collection_details: None,
}
```

where we set the "collection" field with the key of the collection account.

Again, we set the "verified" boolean to false, since this NFT has not yet been verified as part of the desired collection

---

## Verify a NFT as part of a collection:

The accounts needed to verify a NFT as part of a collection are the following:

```rust
#[derive(Accounts)]
pub struct VerifyCollectionMint<'info> {
    pub authority: Signer<'info>,
    #[account(mut)]
    pub metadata: Account<'info, MetadataAccount>,
    pub mint: Account<'info, Mint>,
    #[account(
        seeds = [b"authority"],
        bump,
    )]
    /// CHECK: This account is not initialized and is being used for signing purposes only
    pub mint_authority: UncheckedAccount<'info>,
    pub collection_mint: Account<'info, Mint>,
    #[account(mut)]
    pub collection_metadata: Account<'info, MetadataAccount>,
    pub collection_master_edition: Account<'info, MasterEditionAccount>,
    pub system_program: Program<'info, System>,
    #[account(address = INSTRUCTIONS_ID)]
    /// CHECK: Sysvar instruction account that is being checked with an address constraint
    pub sysvar_instruction: UncheckedAccount<'info>,
    pub token_metadata_program: Program<'info, Metadata>,
}
```

### Let's break down these accounts:

- authority: signer of the transaction. This can be used to restrict the address that can execute the verify collection method, by adding constraints

- metadata: the metadata account of the NFT that we want to verify

- mint: the NFT that we want to verify

- mint_authority: the mint_authority of the Collection NFT

- collection_mint: the mint account of the Collection NFT

- collection_metadata: the metadata account of the Collection NFT

- collection_master_edition: the master edition account of the Collection NFT

- system_program: program resposible for the initialization of any new account

- sysvar_instruction: the instructions sysvar provides access to the serialized instruction data
  for the currently-running transaction

- token_metadata_program: MPL token metadata program that will be used to verify the NFT as part of the desired collection

Note that the only account that need to be mutable in here, are the NFT and Colelction NFT metadata accounts.
This is due to the fact that both will be updated. The NFT metadata account will have the "verified" boolean set to true, and the Collection NFT metadata account will have the colelction size incremented

### We then implement some functionality for our VerifyCollectionMint context:

```rust
impl<'info> VerifyCollectionMint<'info> {
    pub fn verify_collection(&mut self, bumps: &VerifyCollectionMintBumps) -> Result<()> {
        let metadata = &self.metadata.to_account_info();
        let authority = &self.mint_authority.to_account_info();
        let collection_mint = &self.collection_mint.to_account_info();
        let collection_metadata = &self.collection_metadata.to_account_info();
        let collection_master_edition = &self.collection_master_edition.to_account_info();
        let system_program = &self.system_program.to_account_info();
        let sysvar_instructions = &self.sysvar_instruction.to_account_info();
        let spl_metadata_program = &self.token_metadata_program.to_account_info();

        let seeds = &[
            &b"authority"[..],
            &[bumps.mint_authority]
        ];
        let signer_seeds = &[&seeds[..]];

        let verify_collection = VerifyCollectionV1Cpi::new(
            spl_metadata_program,
            VerifyCollectionV1CpiAccounts {
                authority,
                delegate_record: None,
                metadata,
                collection_mint,
                collection_metadata: Some(collection_metadata),
                collection_master_edition: Some(collection_master_edition),
                system_program,
                sysvar_instructions,
            }
        );
        verify_collection.invoke_signed(signer_seeds)?;

        msg!("Collection Verified!");

        Ok(())
    }
}
```

In this "verify_collection" method, we simply create a CPI to the to the Token Metadata Program with the appropriate accounts to verify the NFT as part of a collection. Since the authority of the Collection NFT will sign that CPI, the NFT will be verified as part of the collection.

---

With this examples, you will be able to adjust / adapt it to your needs and create Collections, Mint NFTs, and verify NFTs as part of collections
