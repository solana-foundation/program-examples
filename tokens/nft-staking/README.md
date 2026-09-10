# NFT Staking

Stake an NFT to earn reward tokens over time, then claim those rewards without
having to unstake.

The NFT never leaves the owner's wallet. Instead of transferring it into a
vault, the program is made the **delegate** of the owner's token account and
then **freezes** that account through Metaplex Token Metadata. The NFT stays
visible in the owner's wallet and in marketplace views, but cannot be
transferred or sold until it is unstaked. This is how NFT staking generally
works in production, and it is a different custody model from the vault used in
[escrow](../escrow).

Note that this is not Solana's built-in staking. Native staking delegates SOL to
a validator through the Stake program and earns protocol inflation on an epoch
schedule. This is an application-level staking pool: the rewards are a token
this program mints under rules it sets itself, and none of it touches consensus.

## What this example demonstrates

- **Delegate-and-freeze custody** — `approve` to hand a PDA delegate authority,
  then a `FreezeDelegatedAccount` CPI into Metaplex to immobilise the NFT in
  place. Unstaking reverses it with `ThawDelegatedAccount` and `revoke`.
- **Checkpointed reward accrual** — paying out a balance that grows with time,
  without ever paying for the same span twice.
- **PDA-signed CPIs** — the stake account signs the freeze and thaw; the config
  PDA signs as the reward mint's authority.
- **Events** — `emit!` on every state change so indexers can follow a pool
  without polling.
- **Verified collection gating** — only NFTs from a specific, _verified_
  collection can be staked.

## Instructions

| Instruction         | What it does                                                                              |
| ------------------- | ----------------------------------------------------------------------------------------- |
| `initialize_config` | Creates the pool and its reward mint, whose mint authority is the config PDA              |
| `initialize_user`   | Creates the caller's totals account for one pool                                          |
| `stake`             | Verifies collection membership, delegates the token account to a PDA, and freezes it      |
| `claim`             | Pays out rewards accrued since the last claim — callable while the NFT is still staked    |
| `unstake`           | Settles any outstanding rewards, thaws and un-delegates the NFT, closes the stake account |

## Accounts

| Account        | Seeds                         | Holds                                                          |
| -------------- | ----------------------------- | -------------------------------------------------------------- |
| `StakeConfig`  | `["config", admin]`           | Collection, reward rate, stake cap, freeze period              |
| `UserAccount`  | `["user", config, user]`      | Lifetime points earned, how many NFTs are currently staked     |
| `StakeAccount` | `["stake", nft_mint, config]` | Owner, mint, `staked_at`, and the `last_claimed_at` checkpoint |

`StakeAccount` doubles as the SPL delegate for the staked NFT's token account,
which is what lets the program freeze and thaw it.

Pools are seeded by their admin rather than living at a single `["config"]`
address, so anyone can run one and no one can take the only slot. `UserAccount`
is scoped to its pool for the same reason — the stake cap and points total
belong to one pool, so hitting the cap in one does not lock a user out of another.
`initialize_config` also validates its own settings: `unstake` pays out before it thaws,
so a reward rate large enough to overflow `u64` would leave the NFT frozen with
no way to recover it. Those settings are rejected up front instead.

## The part worth reading closely: paying for time, once

Rewards here are a function of elapsed time rather than of a balance somebody
deposited. That makes the payout path the dangerous one, and it is worth being
explicit about why.

`claim` computes what is owed as `(now - last_claimed_at) → whole days → points`
and then **advances `last_claimed_at` in the same instruction**. If it paid out
but forgot to move the checkpoint, the very next call would read the same span
again and pay for it a second time — draining the reward mint one repeated
transaction at a time.

There is no lock to forget on Solana, and no reentrancy guard to add. The
defence is simply that settling and checkpointing happen together, on one
account, in one instruction. The whole of it lives in
[`instructions/shared.rs`](./anchor/programs/nft-staking/src/instructions/shared.rs).

There is a second, quieter bug in the same few lines. Only whole days pay out,
so a claim at 1.5 days owes one day. If the checkpoint were then snapped to
`now`, that leftover half day would vanish — and anyone claiming every 23 hours
would earn nothing, forever. Advancing by exactly `full_days * SECONDS_PER_DAY`
keeps the remainder banked for next time.

Both mistakes are covered by tests that fail if you reintroduce them:
_"Refuses to pay the same day twice"_ and _"Banks the part-day remainder instead
of forfeiting it"_.

## One more trap: freezing an NFT you do not own

Both `approve` and the Metaplex freeze succeed happily on a **zero-balance**
token account. Anyone can open an associated token account for any mint, so
without an explicit balance check a user could open an empty account for some
NFT in the collection, "stake" it, and farm rewards from an NFT they never
owned.

```rust
require!(self.nft_token_account.amount == 1, StakeError::NftNotHeld);
```

Covered by _"Rejects staking an NFT the signer does not actually hold"_ — delete
that one line and the test suite reports the stake succeeding.

## Building and testing

```bash
pnpm install   # also dumps Metaplex Token Metadata into tests/fixtures/
anchor test
```

Tests run on [LiteSVM](https://github.com/LiteSVM/litesvm), which can move its
own clock — necessary here, since every interesting behaviour in a staking
program only shows up after time passes. The suite mints a real collection and
real NFTs against the actual Metaplex program loaded from a local fixture, so
the freeze and thaw paths are exercised for real rather than mocked.

## Notes

- `max_stake` caps how many NFTs one user may stake at once, per pool.
- `freeze_period_days` is a minimum staking duration; `unstake` rejects until it
  has elapsed. Rewards still accrue and can be claimed during it.
- Reward token decimals are set when the pool is created, and points are scaled
  by them at payout.
