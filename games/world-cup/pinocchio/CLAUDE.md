# CLAUDE.md

World Cup bracket-prediction game: fixed entry fee, consistency-checked 32-game bracket, admin oracle posts results, permissionless `refresh_score` folds brackets into a global tally, unique winner sweeps the pot. Pinocchio program + Codama-generated TS client + Vite webapp shell.

Below is only what the code and the `justfile` do not tell you.

## Design decisions

- **The ranking key is total** (score, then goal-closeness, then earliest submission), so exactly one winner always exists. That is what lets `finalize` prove a winner instead of the program carrying split-pot logic.
- **Scoring is folded, not iterated.** `refresh_score` is permissionless and idempotent (guarded by each bracket's `tally_mask`), so the tally is provable without a single transaction looping over every bracket.
- **Oracle results are immutable once set**, and `post_goals` requires all 32 results first. Re-posting a game would retroactively invalidate already-folded brackets.
- Events are Anchor-compatible self-CPI (`emit_event` signed by the `event_authority` PDA, derived at compile time via `const-crypto`) purely so existing Anchor indexers detect them by the 8-byte event tag.

## Gotchas

- `idl/` is committed; the clients' `generated/` dirs are gitignored and regenerated from it. `just generate-idl && git diff` is the drift check after touching any `#[codama(...)]` attribute.
- Own Cargo workspace, excluded from the repo's pinocchio CI workflow by design; `just setup && just build && just test` is the only path.
- When extending: emit an event per new instruction and add an integration test per instruction in `tests/integration-tests/`.

Program ID `wCupoZtR1g1NXRRVELe5KqFgayyEteVKKxEerxugvxA` (keypair in `keys/`, gitignored).
