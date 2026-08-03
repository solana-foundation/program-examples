# Transfer SOL

A simple example of transferring SOL between two system accounts. You can transfer SOL between many types of accounts, not just system accounts (owned by the System Program).

One thing to note here is that we are generating a brand new keypair in the test - both for `native` and `anchor`. The act of transferring SOL to the new keypair's account will initialize it as a default system account (hence the `/// CHECK` above it in the `anchor` example).
