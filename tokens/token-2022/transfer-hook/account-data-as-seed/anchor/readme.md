# Using token account data in transfer hook

Sometimes you may want to use account data to derive additional accounts in the
extra account metas. This is useful if, for example, you want to use the token
account's owner as a seed for a PDA.

When creating the ExtraAccountMeta you can use the data of any account as an
extra seed. In this case we want to derive a counter account from the token
account owner and the string 'counter'. This means we will be always able to see
how often that token account owner has transferred tokens.

This is how you set it up in the `extra_account_metas()` function.

```rust
// Define extra account metas to store on extra_account_meta_list account
impl<'info> InitializeExtraAccountMetaList<'info> {
    pub fn extra_account_metas() -> Result<Vec<ExtraAccountMeta>> {
        Ok(
            vec![
                ExtraAccountMeta::new_with_seeds(
                    &[
                        Seed::Literal {
                            bytes: b"counter".to_vec(),
                        },
                        Seed::AccountData { account_index: 0, data_index: 32, length: 32 },
                    ],
                    false, // is_signer
                    true // is_writable
                )?
            ]
        )
    }
}
```

Let's look at the token account struct to understand how the account data is
stored. Below is an example of a token account structure. So we can take 32
bytes at position 32 to 64 as the owner of the token account, which is at
'account_index: 0'. 'account_index` refers to the index of the account in the
accounts array. In the case of a transfer hook, the owner token account is the
first entry in the accounts array. The second account is always the mint and the
third account is the destination token account. This account order is the same
as in the old token program.

```rust
/// Account data.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Account {
    /// The mint associated with this account
    pub mint: Pubkey,
    /// The owner of this account.
    pub owner: Pubkey,
    /// The amount of tokens this account holds.
    pub amount: u64,
    pub delegate: COption<Pubkey>,
    pub state: AccountState,
    pub is_native: COption<u64>,
    pub delegated_amount: u64,
    pub close_authority: COption<Pubkey>,
}
```

I our case we want to derive a counter account from the owner of the sender
token account so when we create the ExtraAccountMeta accounts we `init`this PDA
counter account that is derived from the sender token account owner and the
string 'counter'. When the PDA counter account is initialized we will be able to
use it with in the transfer hook to increase it in every transfer.

```rust
#[derive(Accounts)]
pub struct InitializeExtraAccountMetaList<'info> {
    #[account(mut)]
    payer: Signer<'info>,

    /// CHECK: ExtraAccountMetaList Account, must use these seeds
    #[account(
        init,
        seeds = [b"extra-account-metas", mint.key().as_ref()],
        bump,
        space = ExtraAccountMetaList::size_of(
            InitializeExtraAccountMetaList::extra_account_metas()?.len()
        )?,
        payer = payer
    )]
    pub extra_account_meta_list: AccountInfo<'info>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(init, seeds = [b"counter", payer.key().as_ref()], bump, payer = payer, space = 16)]
    pub counter_account: Account<'info, CounterAccount>,
    pub token_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}
```

We also need to define this extra counter account in the TransferHook struct.
These are the accounts that are passed to our TransferHook program every time a
transfer is done. The client get the additional accounts from the
ExtraAccountsMetaList PDA but here in the program we still need to define it.

```rust
#[derive(Accounts)]
pub struct TransferHook<'info> {
    #[account(token::mint = mint, token::authority = owner)]
    pub source_token: InterfaceAccount<'info, TokenAccount>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(token::mint = mint)]
    pub destination_token: InterfaceAccount<'info, TokenAccount>,
    /// CHECK: source token account owner, can be SystemAccount or PDA owned by another program
    pub owner: UncheckedAccount<'info>,
    /// CHECK: ExtraAccountMetaList Account,
    #[account(seeds = [b"extra-account-metas", mint.key().as_ref()], bump)]
    pub extra_account_meta_list: UncheckedAccount<'info>,
    #[account(seeds = [b"counter", owner.key().as_ref()], bump)]
    pub counter_account: Account<'info, CounterAccount>,
}
```

In the client this account is auto generated and you can use it like this.

```rust
const transferInstructionWithHelper =
await createTransferCheckedWithTransferHookInstruction(
    connection,
    sourceTokenAccount,
    mint.publicKey,
    destinationTokenAccount,
    wallet.publicKey,
    amountBigInt,
    decimals,
    [],
    "confirmed",
    TOKEN_2022_PROGRAM_ID
);
```

The helper function is resolving the account automatically from the
ExtraAccounts data account. How the account would be resolved in the client is
like this:

```js
const [counterPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('counter'), wallet.publicKey.toBuffer()],
    program.programId,
);
```

Note that the counter account is derived from the owner of the token account and
needs to be initialized before doing a transfer. In the case of this example we
initialize the counter account when we initialize the extra account metas. So we
will only have a counter PDA for the owner of the token account that called that
function. If you want to have a counter account for every token account for your
mint out there you will need to have some functionality to create these PDAs
before hand. There could be a button on your dapp to sign up for a counter that
creates this PDA account and from then on the users can use this counter token.
