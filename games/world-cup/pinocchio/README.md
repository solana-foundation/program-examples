# World Cup

A World Cup bracket-prediction game on Solana: a Pinocchio on-chain program and
a Codama-generated Rust client.

Entrants pay a fixed fee to submit a consistency-checked 32-game bracket; an
admin oracle records results; a permissionless `refresh_score` folds each bracket
into a provable on-chain tally; the unique winner sweeps the pot. The ranking key
is total — score, then goal-closeness, then earliest submission — so exactly one
winner always exists.

## Layout

| Path                       | What                                                            |
| -------------------------- | --------------------------------------------------------------- |
| `program/`                 | Pinocchio program (`world-cup-program`)                         |
| `tests/integration-tests/` | LiteSVM integration tests (`tests-world-cup`)                   |
| `clients/rust/`            | Codama-generated Rust client (`world-cup-client`)               |
| `scripts/`                 | Codama client generation                                        |
| `idl/`                     | Generated IDL                                                   |

## Quick start

```bash
# Prerequisites: rustup, the Solana CLI, pnpm, just
just setup            # install JS dependencies
just build            # program .so → IDL → Rust client
just test             # unit + LiteSVM integration tests
```

## The program

Accounts: a singleton `Config` (admin, lifecycle, global tally), a singleton
`Oracle` (game results + Round-of-32 goal total), per-wallet `Bracket`s, and a
pot `["vault"]` PDA.

Instructions: `init_config`, `submit_bracket`, `lock`, `post_result`,
`post_goals`, `refresh_score`, `finalize`, `claim`, `close_bracket`.

Edit the Rust types, then `just generate-clients` regenerates the IDL and the
Rust client.

## License

MIT — see [LICENSE](LICENSE).
