# World Cup bracket prediction

A bracket-prediction game on Solana. Entrants pay a fixed fee to submit a
consistency-checked 32-game bracket; an admin oracle records results; a
permissionless `refresh_score` folds each bracket into a provable on-chain
tally; the unique winner sweeps the pot. The ranking key is total — score, then
goal-closeness, then earliest submission — so exactly one winner always exists.

Lifecycle: `init_config` → `submit_bracket` → `lock` → `post_result` /
`post_goals` → `refresh_score` → `finalize` → `claim`.

This is a faithful, self-contained port of the upstream project: a Pinocchio
on-chain program with a Codama-generated Rust client and LiteSVM integration
tests. It pins its own toolchain
and dependencies (`pinocchio 0.11.1`, `codama`, `pinocchio-token-2022`) in a
nested workspace, so it builds and tests via its own `justfile` rather than the
repo's shared CI. See the [pinocchio](./pinocchio) directory for the source,
build commands, and tests.

[pinocchio](./pinocchio)
