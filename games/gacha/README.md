# Gacha

A provably-fair **gacha** (loot-box / pack-pull) game — the on-chain mechanic behind
Solana RWA pack platforms . An admin configures a
pool of fixed-weight reward tiers and a fixed entry fee; buyers open pulls that are
revealed with a verifiable random function (RFC 9381 ECVRF), and each prize is
minted as a Token-2022 NFT carrying its `rarity` in the token metadata.

The VRF input binds buyer-supplied entropy (`SHA-256(pull || client_seed)`), so no
one — including the operator — can predict an outcome before the buy lands, and
every reveal is publicly verifiable off-chain. Unsettled pulls are refundable after
a deadline.

Two variants share the same draw semantics (`select_tier`/`derive_alpha` are
byte-identical, pinned by shared test fixtures) and differ in how reveals are
evidenced:

| Variant                                        | Reveal evidence                                                                                                                                                 |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`./pinocchio`](./pinocchio)                   | Each reveal is anchored in Collector Crypt's deployed [`cc-vrf`](https://vrf.collectorcrypt.com) registry by CPI (Light Protocol compressed accounts)            |
| [`./pinocchio-simple`](./pinocchio-simple)     | Each prize NFT carries its full reveal provenance (`pull`, `client_seed`, `beta`, `proof`) in its own Token-2022 metadata — verifiable from the mint account alone |

Both examples are self-contained nested workspaces: each pins its own toolchain
and dependencies and builds/tests via its own `justfile`.
