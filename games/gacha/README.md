# Gacha

A provably-fair **gacha** (loot-box / pack-pull) game — the on-chain mechanic behind
Solana RWA pack platforms . An admin configures a
pool of fixed-weight reward tiers and a fixed entry fee; buyers open pulls that are
revealed with a verifiable random function (RFC 9381 ECVRF) anchored in Collector
Crypt's deployed [`cc-vrf`](https://vrf.collectorcrypt.com) registry by CPI, and each
prize is minted as a Token-2022 NFT carrying its `rarity` in the token metadata.

The VRF input binds buyer-supplied entropy (`SHA-256(pull || client_seed)`), so no
one — including the operator — can predict an outcome before the buy lands, and
every reveal is publicly verifiable off-chain. Unsettled pulls are refundable after
a deadline.

| Framework | Path                         |
| --------- | ---------------------------- |
| Pinocchio | [`./pinocchio`](./pinocchio) |

The Pinocchio example is a self-contained nested workspace: it pins its own toolchain
and dependencies and builds/tests via its own `justfile`.
