## Token swap example amm in anchor rust

**Automated Market Makers (AMM)** - Your Gateway to Effortless Trading!
Welcome to the world of Automated Market Makers (AMM), where seamless trading is made possible with the power of automation. The primary goal of AMMs is to act as automatic buyers and sellers, readily available whenever users wish to trade their assets.

**Advantages of AMMs:**

- Always Available Trading: Thanks to the algorithmic trading, AMMs are operational round-the-clock, ensuring you never miss a trading opportunity.

- Low Operational Costs: Embrace cheaper trades as AMMs eliminate the need for a market-making firm. Say goodbye to hefty fees! (In practice, MEV bots handle this role.)

Selecting the right algorithm for the AMM becomes the essential task. One fascinating development in blockchain AMMs is the Constant Function AMM (CFAMM), which permits trades that preserve a predefined condition on a constant function of the AMM's reserves, known as the Invariant. This enforcement compels the reserves to evolve along a remarkable Bonding Curve.

Meet the Constant Product AMM (CPAMM): Among the simplest CFAMMs and made popular by Uniswap V2, the CPAMM ensures the product of both reserves (xy) remains constant (K) for a given liquidity quantity. Simply put, if x denotes the reserve of token A and y denotes the reserve of token B, then xy = K, with K depending on the liquidity.

_Discover Diverse Bonding Curves:_

- Constant Sum AMM (CSAMM): The pool's invariant, x + y = K, maintains a constant price, but reserves for each asset can be emptied.

- Curve's Stableswap: A clever mix of CSAMM and CPAMM, the Stableswap brings unique properties to the AMM, depending on the token balance.

- Uniswap V3 Concentrated Liquidity AMM (CLAMM): Utilizing CPAMM, this model splits the curve into independent buckets, allowing liquidity provision to specific price buckets for efficient trading.

- Trader Joe CLAMM: Similar to UniV3 CLAMM, it divides the price range into buckets, where each bucket operates as a CSAMM instead of a CPAMM.

_The Undeniable Perks of CPAMMs:_

- Easier to Understand and Use: Unlike complex liquidity buckets, CPAMMs offer a single, user-friendly pool for straightforward trading.

- Memory Efficiency: With just one pool to maintain instead of multiple buckets, CPAMMs are incredibly memory-efficient, leading to lower memory usage and reduced costs.

For these reasons, we focus on implementing the CPAMM.

## Program Implementation

### Design

Let's go over the essential requirements for our smart contract design:

- Fee Distribution: Every pool must have a fee to reward Liquidity Providers (LPs). This fee is charged on trades and paid directly in the traded token. To maintain consistency across all pools, the fees will be shared.

- Single Pool per Asset Pair: Each asset pair will have precisely one pool. This approach avoids liquidity fragmentation and simplifies the process for developers to locate the appropriate pool.

- LPs Deposit Accounting: We need to keep track of LPs deposits in the smart contract.

To achieve an efficient and organized design, we can implement the following strategies:

- Shared Parameters: As pools can share certain parameters like the trading fee, we can create a single account to store these shared parameters for all pools. Additionally, each pool will have its separate account. This approach saves storage space, except when the configuration is smaller than 32 bytes due to the need to store the public key. In our case, we'll include an admin for the AMM to control fees, which exceeds the limit.

- Unique Pool Identification: To ensure each pool remains unique, we'll utilize seeds to generate a Program Derived Account (PDA). This helps avoid any ambiguity or confusion.

- SPL Token for Liquidity Accounting: We'll utilize the SPL token standard for liquidity accounting. This choice ensures easy composability and simplifies the handling of liquidity in the contract.

By implementing these strategies, we are creating a solana program that efficiently manages liquidity pools, rewards LPs, and maintains a seamless trading experience across various asset pairs.

## Principals

Here are some essential principles to consider when building on-chain programs in Solana:

- Store Keys in the Account: It's beneficial to store keys in the account when creating Program Derived Accounts (PDAs) using seeds. While this may increase account rent slightly, it offers significant advantages. By having all the necessary keys in the account, it becomes effortless to locate the account (since you can recreate its public key). Additionally, this approach works seamlessly with Anchor's has_one clause, streamlining the process.

- Simplicity in Seeds: When creating PDA seeds, prioritize simplicity. Using a straightforward logic for seeds makes it easier to remember and clarifies the relationship between accounts. A logical approach is to first include the seeds of the parent account and then use the current object's identifiers, preferably in alphabetical order. For example, in an AMM account storing configuration (with no parent), adding an identifier attribute, usually a pubkey, becomes necessary since the admin can change. For pools, which have the AMM as a parent and are uniquely defined by the tokens they facilitate trades for, it's advisable to use the AMM's pubkey as the seed, followed by token A's pubkey and then token B's.

- Minimize Instruction's Scope: Keeping each instruction's scope as small as possible is crucial for several reasons. It helps reduce transaction size by limiting the number of accounts touched simultaneously. Moreover, it enhances composability, readability, and security. However, a trade-off to consider is that it may lead to an increase in Lines Of Code (LOC).

- By following these principles, you can build on-chain programs in Solana that are efficient, well-organized, and conducive to seamless interactions, ensuring a robust foundation for your blockchain projects.

## Code Examples

```file structure
programs/token-swap/src/
├── constants.rs
├── errors.rs
├── instructions
│   ├── create_amm.rs
│   ├── create_pool.rs
│   ├── deposit_liquidity.rs
│   ├── mod.rs
│   ├── swap_exact_tokens_for_tokens.rs
│   └── withdraw_liquidity.rs
├── lib.rs
└── state.rs
```

1. **Entrypoint**

This code is entrypoint for a swap example using the **`anchor_lang`** library. The **`anchor_lang`** library provides tools for creating Solana programs using the Anchor framework. The code defines several functions:

(https://github.com/solana-developers/program-examples/blob/419cb6b6c20e8b1c65711b68a4dde2527725cc1a/tokens/token-swap/anchor/programs/token-swap/src/lib.rs#L1-L8)

The above section contains the necessary imports and module declarations for the program. It imports modules from the anchor_lang library and declares local modules for the crate. The pub use instructions::*; re-exports all items from the instructions module so that they can be accessed from outside this module.

https://github.com/solana-developers/program-examples/blob/419cb6b6c20e8b1c65711b68a4dde2527725cc1a/tokens/token-swap/anchor/programs/token-swap/src/lib.rs#L10-L11

This macro declares the program ID and associates it with the given string. This ID should match the deployed Solana program's ID to ensure the correct program is invoked when interacting with the smart contract.

https://github.com/solana-developers/program-examples/blob/419cb6b6c20e8b1c65711b68a4dde2527725cc1a/tokens/token-swap/anchor/programs/token-swap/src/lib.rs#L13-L45

This section defines the program module using the **`#[program]`** attribute. Each function in this module represents an entry point to the smart contract. Each entry point function takes a **`Context`** parameter, which provides essential information for executing the function, such as the accounts involved and the transaction context.

The entry point functions call their respective functions from the **`instructions`** module, passing the required arguments.

Overall, this code defines a Rust module for a Solana program using the Anchor framework. The program supports functions related to creating an Automated Market Maker (AMM) and interacting with it, such as creating a pool, depositing liquidity, withdrawing liquidity, and swapping tokens using an AMM mechanism.

2. **Account Definitions**

Let's embark on our exploration by charting the course for our accounts. Each account will be thoughtfully defined, beginning with their keys arranged in the precise order they will appear in the seeds. Following the keys, we'll list the attributes that are utilized for each account. As we journey through this process, we'll unravel the intricate web of connections and forge a path towards a cohesive and well-structured design. Let the exploration begin!

The above code declares an account structure called **`Amm`**. The **`#[account]`** attribute indicates that this structure will be used as an account on the Solana blockchain. The **`#[derive(Default)]`** attribute automatically generates a default implementation of the struct with all fields set to their default values.

The **`Amm`** struct has three fields:

1. **`id`**: The primary key of the AMM, represented as a **`Pubkey`**.
2. **`admin`**: The account that has admin authority over the AMM, represented as a **`Pubkey`**.
3. **`fee`**: The LP fee taken on each trade, represented as a **`u16`** (unsigned 16-bit integer) in basis points.

https://github.com/solana-developers/program-examples/blob/419cb6b6c20e8b1c65711b68a4dde2527725cc1a/tokens/token-swap/anchor/programs/token-swap/src/state.rs#L1-L14

The above code declares an account structure called Amm. The #[account] attribute indicates that this structure will be used as an account on the Solana blockchain. The #[derive(Default)] attribute automatically generates a default implementation of the struct with all fields set to their default values.

https://github.com/solana-developers/program-examples/blob/419cb6b6c20e8b1c65711b68a4dde2527725cc1a/tokens/token-swap/anchor/programs/token-swap/src/state.rs#L16-L18

This code implements a constant LEN for the Amm struct, which represents the size of the Amm account in bytes. The size is calculated by adding the sizes of the individual fields (id, admin, and fee). For example, Pubkey has a fixed size of 32 bytes, and u16 has a size of 2 bytes.

https://github.com/solana-developers/program-examples/blob/419cb6b6c20e8b1c65711b68a4dde2527725cc1a/tokens/token-swap/anchor/programs/token-swap/src/state.rs#L20-L31

The code declares another account structure called **`Pool`**. As before, the **`#[account]`** attribute indicates that this struct will be used as an account on the Solana blockchain, and the **`#[derive(Default)]`** attribute generates a default implementation with all fields set to their default values.

The **`Pool`** struct has three fields:

1. **`amm`**: The primary key of the AMM (Automated Market Maker) that this pool belongs to, represented as a **`Pubkey`**.
2. **`mint_a`**: The mint of token A associated with this pool, represented as a **`Pubkey`**.
3. **`mint_b`**: The mint of token B associated with this pool, represented as a **`Pubkey`**.

https://github.com/solana-developers/program-examples/blob/419cb6b6c20e8b1c65711b68a4dde2527725cc1a/tokens/token-swap/anchor/programs/token-swap/src/state.rs#L33-L35

This code implements a constant LEN for the Pool struct, which represents the size of the Pool account in bytes. Similar to the Amm struct, the size is calculated by adding the sizes of the individual fields (amm, mint_a, and mint_b). Each Pubkey has a size of 32 bytes, and the total size is 8 bytes (for padding) + 32 bytes (amm) + 32 bytes (mint_a) + 32 bytes (mint_b) = 104 bytes.

3. **Instructions**

    3.1 **create amm**

    https://github.com/solana-developers/program-examples/blob/419cb6b6c20e8b1c65711b68a4dde2527725cc1a/tokens/token-swap/anchor/programs/token-swap/src/instructions/create_amm.rs#L1-L12

    The above code defines a function named **`create_amm`** that is used to create an AMM account. It takes three parameters:

1. **`ctx`**: The **`Context<CreateAmm>`** parameter contains the context data required to execute the function.
1. **`id`**: The **`Pubkey`** parameter represents the ID for the new AMM account.
1. **`fee`**: The **`u16`** parameter represents the LP fee (in basis points) to be set for the new AMM account.

The function does the following:

- It gets a mutable reference to the AMM account from the context using **`let amm = &mut ctx.accounts.amm;`**.
- It sets the fields of the AMM account with the provided values using **`amm.id = id;`**, **`amm.admin = ctx.accounts.admin.key();`**, and **`amm.fee = fee;`**.
- It returns **`Ok(())`** to indicate the success of the operation.

https://github.com/solana-developers/program-examples/blob/419cb6b6c20e8b1c65711b68a4dde2527725cc1a/tokens/token-swap/anchor/programs/token-swap/src/instructions/create_amm.rs#L14-L39

This code defines a struct **`CreateAmm`** using the **`Accounts`** attribute, which serves as the accounts instruction for the **`create_amm`** function.

The **`CreateAmm`** struct has four fields:

1. **`amm`**: An account field marked with **`init`** attribute, which represents the AMM account to be created. It uses the provided **`id`** as a seed to derive the account address, sets the required space for the account using **`Amm::LEN`**, and uses the **`payer`** account for paying rent. Additionally, it specifies a constraint to ensure that the fee is less than 10000 basis points; otherwise, it will raise the error **`TutorialError::InvalidFee`**.
2. **`admin`**: An **`AccountInfo`** field representing the admin account for the AMM. It is read-only and not mutable.
3. **`payer`**: A **`Signer`** field representing the account that pays for the rent of the AMM account. It is marked as mutable.
4. **`system_program`**: A **`Program`** field representing the Solana system program, used for certain system operations.

TLDR-, this code sets up the instruction structure for the **`create_amm`** function, defining how the accounts should be initialized, accessed, and used when calling the function.

3.2 **create pool**

https://github.com/solana-developers/program-examples/blob/419cb6b6c20e8b1c65711b68a4dde2527725cc1a/tokens/token-swap/anchor/programs/token-swap/src/instructions/create_pool.rs#L1-L20

The above code defines a function named **`create_pool`** that creates a liquidity pool. It takes a single parameter, **`ctx`**, which represents the **`Context<CreatePool>`** used to execute the function.

The function does the following:

- It gets a mutable reference to the **`Pool`** account from the context using **`let pool = &mut ctx.accounts.pool;`**.
- It sets the fields of the **`Pool`** account with the keys of the associated accounts using **`pool.amm = ctx.accounts.amm.key();`**, **`pool.mint_a = ctx.accounts.mint_a.key();`**, and **`pool.mint_b = ctx.accounts.mint_b.key();`**.
- It returns **`Ok(())`** to indicate the success of the operation.

https://github.com/solana-developers/program-examples/blob/419cb6b6c20e8b1c65711b68a4dde2527725cc1a/tokens/token-swap/anchor/programs/token-swap/src/instructions/create_pool.rs#L22-L101

This code defines a struct named **`CreatePool`**, which serves as the accounts instruction for the **`create_pool`** function.

The **`CreatePool`** struct has several fields, each representing an account that the **`create_pool`** function needs to access during its execution. The attributes applied to each field define the behavior of how the accounts are accessed and handled.

Here's an explanation of each field:

1. **`amm`**: An account field representing the AMM (Automated Market Maker) associated with the pool. It derives the address of the account using the seed of the AMM account.
2. **`pool`**: An account field that will be initialized as the new liquidity pool account. It specifies the required space for the account, derives the address using seeds derived from the AMM, and ensures that **`mint_a`**'s key is less than **`mint_b`**'s key (assumes lexicographic order) to prevent invalid creation of the pool.
3. **`pool_authority`**: An account info field representing the read-only authority account for the pool. It is used as a seed to derive the address of the **`mint_liquidity`** account.
4. **`mint_liquidity`**: A boxed account field representing the mint for the liquidity tokens (LP tokens) of the pool. It is initialized with the provided authority and has a fixed decimal precision of 6.
5. **`mint_a`** and **`mint_b`**: Boxed account fields representing the mints for token A and token B, respectively.
6. **`pool_account_a`** and **`pool_account_b`**: Boxed account fields representing the associated token accounts for token A and token B, respectively, for the pool. These accounts are associated with their respective mints and have **`pool_authority`** as their authority.
7. **`payer`**: A signer field representing the account that pays for the rent of the new accounts.
8. **`token_program`**, **`associated_token_program`**, and **`system_program`**: Program fields representing the Solana token program, associated token program, and system program, respectively.

TLDR, this code defines the accounts instruction structure for the **`create_pool`** function, specifying how the accounts should be initialized, accessed, and used when calling the function.

3.3 **deposite liquidity**

https://github.com/solana-developers/program-examples/blob/419cb6b6c20e8b1c65711b68a4dde2527725cc1a/tokens/token-swap/anchor/programs/token-swap/src/instructions/deposit_liquidity.rs#L1-L30

The above code defines a function named **`deposit_liquidity`** that allows depositing liquidity into the pool. It takes three parameters:

1. **`ctx`**: The **`Context<DepositLiquidity>`** parameter contains the context data required to execute the function.
2. **`amount_a`**: The **`u64`** parameter represents the amount of token A to be deposited.
3. **`amount_b`**: The **`u64`** parameter represents the amount of token B to be deposited.

The function does the following:

- It checks if the depositor has enough tokens for each type (A and B) before depositing and restricts the amounts to the available balances using the **`if`** conditions.

https://github.com/solana-developers/program-examples/blob/419cb6b6c20e8b1c65711b68a4dde2527725cc1a/tokens/token-swap/anchor/programs/token-swap/src/instructions/deposit_liquidity.rs#L32-L61

This code ensures that the amounts of tokens A and B being deposited are provided in the same proportion as the existing liquidity in the pool. If this is the first deposit (pool creation), the amounts are added as is. Otherwise, the function calculates the ratio of the existing liquidity (pool_a.amount and pool_b.amount) and adjusts the amounts being deposited accordingly.

https://github.com/solana-developers/program-examples/blob/419cb6b6c20e8b1c65711b68a4dde2527725cc1a/tokens/token-swap/anchor/programs/token-swap/src/instructions/deposit_liquidity.rs#L63-L77

This code calculates the amount of liquidity that is about to be deposited into the pool. It calculates the square root of the product of **`amount_a`** and **`amount_b`**, using fixed-point arithmetic to ensure precision.

If this is the first deposit (pool creation), the function checks if the calculated liquidity is greater than the **`MINIMUM_LIQUIDITY`** constant (a minimum liquidity required for the pool). If it's not, the function returns an error to indicate that the deposit is too small. Additionally, it subtracts the **`MINIMUM_LIQUIDITY`** from the calculated liquidity to lock it as the initial liquidity.

https://github.com/solana-developers/program-examples/blob/419cb6b6c20e8b1c65711b68a4dde2527725cc1a/tokens/token-swap/anchor/programs/token-swap/src/instructions/deposit_liquidity.rs#L79-L101

This code uses the token::transfer function from the Anchor SPL token crate to transfer the deposited amounts of tokens A and B from the depositor's accounts (depositor_account_a and depositor_account_b, respectively) to the pool's accounts (pool_account_a and pool_account_b, respectively). It does this through cross-program invocation (CPI) using the token program, and the authority for the transfer is the depositor.

https://github.com/solana-developers/program-examples/blob/419cb6b6c20e8b1c65711b68a4dde2527725cc1a/tokens/token-swap/anchor/programs/token-swap/src/instructions/deposit_liquidity.rs#L102-L124

This code uses the **`token::mint_to`** function from the Anchor SPL token crate to mint the liquidity tokens to the depositor. It does this through cross-program invocation (CPI) using the token program. The minting is authorized by the pool authority (**`pool_authority`**).

The function calculates the correct authority bump, as required by the SPL token program, and creates the necessary seeds for the authority. It then uses the **`CpiContext::new_with_signer`** function to set up the context for the CPI with the correct authority.

TRDR, this code implements the logic to deposit liquidity into the pool, ensuring correct proportions, handling the initial pool creation, and minting the corresponding liquidity tokens to the depositor.

3.4 **swap exact tokens**

https://github.com/solana-developers/program-examples/blob/419cb6b6c20e8b1c65711b68a4dde2527725cc1a/tokens/token-swap/anchor/programs/token-swap/src/instructions/swap_exact_tokens_for_tokens.rs#L1-L27

This code defines a function named **`swap_exact_tokens_for_tokens`** that allows swapping tokens A for tokens B (and vice versa) in the AMM pool. It takes four parameters:

1. **`ctx`**: The **`Context<SwapExactTokensForTokens>`** parameter contains the context data required to execute the function.
2. **`swap_a`**: The **`bool`** parameter indicates whether tokens A should be swapped for tokens B (**`true`**) or tokens B should be swapped for tokens A (**`false`**).
3. **`input_amount`**: The **`u64`** parameter represents the amount of tokens to be swapped.
4. **`min_output_amount`**: The **`u64`** parameter represents the minimum expected output amount after the swap.

The function does the following:

- It checks if the trader has enough tokens for the input amount of the specified token (**`swap_a`**) before proceeding with the swap. If the trader doesn't have enough tokens, it uses the available amount for the swap.

https://github.com/solana-developers/program-examples/blob/419cb6b6c20e8b1c65711b68a4dde2527725cc1a/tokens/token-swap/anchor/programs/token-swap/src/instructions/swap_exact_tokens_for_tokens.rs#L29-L31

This code applies the trading fee to the input amount (input) based on the amm (AMM) account's fee value. The trading fee is subtracted from the input amount to calculate the taxed_input, which is the actual amount of tokens available for the swap after deducting the fee.

https://github.com/solana-developers/program-examples/blob/419cb6b6c20e8b1c65711b68a4dde2527725cc1a/tokens/token-swap/anchor/programs/token-swap/src/instructions/swap_exact_tokens_for_tokens.rs#L33-L56

This code calculates the output amount of the swapped token based on the taxed_input, current pool balances (pool_a.amount and pool_b.amount), and whether the swap is from token A to token B or vice versa. It uses fixed-point arithmetic to ensure precise calculations. The resulting output represents the amount of tokens the trader will receive after the swap.

https://github.com/solana-developers/program-examples/blob/419cb6b6c20e8b1c65711b68a4dde2527725cc1a/tokens/token-swap/anchor/programs/token-swap/src/instructions/swap_exact_tokens_for_tokens.rs#L58-L60

This code checks if the calculated **`output`** is less than the specified **`min_output_amount`**. If so, it returns an error, indicating that the output amount is too small.

https://github.com/solana-developers/program-examples/blob/419cb6b6c20e8b1c65711b68a4dde2527725cc1a/tokens/token-swap/anchor/programs/token-swap/src/instructions/swap_exact_tokens_for_tokens.rs#L62-L63

This code calculates the invariant of the pool, which is the product of the current balances of token A (**`pool_a.amount`**) and token B (**`pool_b.amount`**).

https://github.com/solana-developers/program-examples/blob/419cb6b6c20e8b1c65711b68a4dde2527725cc1a/tokens/token-swap/anchor/programs/token-swap/src/instructions/swap_exact_tokens_for_tokens.rs#L65-L123

This code transfers the input and output amounts of tokens between the trader and the pool, performing the token swap. It uses the **`token::transfer`** function from the Anchor SPL token crate to transfer tokens from one account to another. The **`CpiContext`** is used for Cross-Program Invocation (CPI) to interact with the SPL token program.

The code chooses the appropriate token accounts to perform the transfer based on whether the swap is from token A to token B or vice versa (**`swap_a`**). The transfer authority is specified as either **`trader`** or **`pool_authority`** based on the situation.

https://github.com/solana-developers/program-examples/blob/419cb6b6c20e8b1c65711b68a4dde2527725cc1a/tokens/token-swap/anchor/programs/token-swap/src/instructions/swap_exact_tokens_for_tokens.rs#L124-L130

This code logs a message indicating the details of the trade, including the input amount, the taxed input amount, and the output amount.

https://github.com/solana-developers/program-examples/blob/419cb6b6c20e8b1c65711b68a4dde2527725cc1a/tokens/token-swap/anchor/programs/token-swap/src/instructions/swap_exact_tokens_for_tokens.rs#L132-L141

This code reloads the pool token accounts (pool_account_a and pool_account_b) to get the updated balances after the swap. It then checks if the invariant still holds, ensuring that the product of the balances remains constant. If the invariant is violated, it returns an error.
Finally, this code returns Ok(()) if all operations in the function executed successfully.

3.5 **withdraw liquidity**

https://github.com/solana-developers/program-examples/blob/419cb6b6c20e8b1c65711b68a4dde2527725cc1a/tokens/token-swap/anchor/programs/token-swap/src/instructions/withdraw_liquidity.rs#L1-L11

The use statements import required modules and types for the function.

https://github.com/solana-developers/program-examples/blob/419cb6b6c20e8b1c65711b68a4dde2527725cc1a/tokens/token-swap/anchor/programs/token-swap/src/instructions/withdraw_liquidity.rs#L13

This code defines a function named **`withdraw_liquidity`** that allows a liquidity provider to withdraw their liquidity from the AMM pool. It takes two parameters:

1. **`ctx`**: The **`Context<WithdrawLiquidity>`** parameter contains the context data required to execute the function.
2. **`amount`**: The **`u64`** parameter represents the amount of liquidity tokens the provider wants to withdraw.

https://github.com/solana-developers/program-examples/blob/419cb6b6c20e8b1c65711b68a4dde2527725cc1a/tokens/token-swap/anchor/programs/token-swap/src/instructions/withdraw_liquidity.rs#L14-L22

This code sets up the authority seeds and signer seeds required for performing token transfers and burning the liquidity tokens. The authority seeds include the AMM ID, mint keys of tokens A and B, the authority seed constant, and the authority bump seed. The signer seeds are derived from the authority seeds.

https://github.com/solana-developers/program-examples/blob/419cb6b6c20e8b1c65711b68a4dde2527725cc1a/tokens/token-swap/anchor/programs/token-swap/src/instructions/withdraw_liquidity.rs#L24-L45

This code calculates the amount of token A to be transferred to the liquidity provider by performing the following steps:

1. Calculate the ratio of the amount of liquidity tokens being withdrawn (**`amount`**) to the total supply of liquidity tokens (**`ctx.accounts.mint_liquidity.supply + MINIMUM_LIQUIDITY`**).
2. Calculate the proportional amount of token A based on the pool's token A balance (**`ctx.accounts.pool_account_a.amount`**).
3. Transfer the calculated amount of token A from the pool account to the liquidity provider's account using the **`token::transfer`** function.

https://github.com/solana-developers/program-examples/blob/419cb6b6c20e8b1c65711b68a4dde2527725cc1a/tokens/token-swap/anchor/programs/token-swap/src/instructions/withdraw_liquidity.rs#L47-L67

This code follows the same steps as above but for token B, transferring the calculated amount of token B from the pool account to the liquidity provider's account.

https://github.com/solana-developers/program-examples/blob/419cb6b6c20e8b1c65711b68a4dde2527725cc1a/tokens/token-swap/anchor/programs/token-swap/src/instructions/withdraw_liquidity.rs#L69-L83

This code burns the specified amount of liquidity tokens (amount) by calling the token::burn function. The liquidity tokens are destroyed, reducing the total supply.
Finally, this code returns Ok(()) if all operations in the function executed successfully. This indicates that the liquidity withdrawal was completed without any errors.
