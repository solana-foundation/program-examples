# Create Account

:wrench: We're going to create a Solana account. :wrench:

This account is going to be a **system account** - meaning it will be owned by the System Program. In short, this means only the System Program will be allowed to modify it's data.

In the test, we use two methods for creating the accounts. One of the methods uses Cross program invocation and the other calls the System Program directly.

Cross program invocation means that we send the transaction to create the account first to our deployed Solana Program, which then calls the System Program. See [here](https://github.com/solana-developers/program-examples/tree/main/basics/cross-program-invocation) for more Cross Program Invocation examples.

Calling the System Program directly means that the client sends the transaction to create the account directly to the Solana Program

In this example, this account will simply hold some SOL.

The program also shows how to determine the rent an account needs: it derives the account's size from the instruction payload and asks the `Rent` sysvar for the minimum lamport balance that makes an account of that size rent-exempt.

### Links:

- [Solana Cookbook - How to Create a System Account](https://solanacookbook.com/references/accounts.html#how-to-create-a-system-account)
- [Rust Docs - solana_program::system_instruction::create_account](https://docs.rs/solana-program/latest/solana_program/system_instruction/fn.create_account.html)
