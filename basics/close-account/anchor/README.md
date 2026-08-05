# Close an Account

1. We're creating a `PDA` using [create_user.rs](programs/close-account/src/instructions/create_user.rs)
   instruction.

    ```rust
    #[account(
    init,
    payer=user,
    space=UserState::INIT_SPACE,
    seeds=[b"USER", user.key().as_ref()],
    bump
    )]
    pub user_account: Account<'info, UserState>,
    ```

2. We're closing it using [close_user.rs](programs/close-account/src/instructions/close_user.rs)
   instruction, which uses the `close` account constraint to close the account and return its
   lamports to `user`.

    ```rust
    #[account(
    mut,
    seeds=[b"USER", user.key().as_ref()],
    bump=user_account.bump,
    close=user, // close account and return lamports to user
    )]
    pub user_account: Account<'info, UserState>,
    ```

3. In our test [test.ts](tests/test.ts) we're using `fetchNullable` after closing the account,
   since a closed account no longer exists and should resolve to `null`.

    ```typescript
    const userAccount = await program.account.userState.fetchNullable(userAccountAddress);
    assert.equal(userAccount, null);
    ```
