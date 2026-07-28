# Destroy an Account

1. We're creating a `PDA` using [create_user.rs](programs/destroy-an-account/src/instructions/create_user.rs)
   instruction.

    ```rust
    #[account(
    init,
    seeds=[User::PREFIX.as_bytes(), user.key().as_ref()],
    payer=user,
    space=User::SIZE,
    bump
    )]
    pub user_account: Box<Account<'info, User>>,
    ```

2. We're closing it using [destroy_user.rs](programs/destroy-an-account/src/instructions/destroy_user.rs)
   instruction, which uses `Anchor` `AccoutClose` `trait`.

    ```rust
    user_account.close(user.to_account_info())?;
    ```

3. In our test [destroy-an-account.ts](tests/destroy-an-account.ts) we're using `fetchNullable` since we expect
   the account to be `null` prior to creation and after closing.

    ```typescript
    const userAccountBefore = await program.account.user.fetchNullable(userAccountAddress, "processed");
    assert.equal(userAccountBefore, null);
    ...
    ...
    const userAccountAfter = await program.account.user.fetchNullable(userAccountAddress, "processed");
    assert.notEqual(userAccountAfter, null);
    ```
