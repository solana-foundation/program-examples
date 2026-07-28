# Checking Accounts

Solana Programs should perform checks on instructions to ensure security and that required invariants
are not being violated.

These checks vary and depend on the exact task of the Solana Program.

In this example we see some of the common checks a Solana Program can perform:

- checking the program ID from the instruction is the program ID of your program
- checking that the order and number of accounts are correct
- checking the initialization state of an account
- etc.
