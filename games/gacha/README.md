# Gacha

A provably-fair **gacha** (loot-box / pack-pull) game — the on-chain mechanic behind
Solana RWA pack platforms like Collector Crypt and Phygitals. An admin configures a
pool of weighted reward tiers with limited supply and a fixed entry fee; buyers open
pulls that are revealed with a verifiable random function (RFC 9381 ECVRF), following
the model Collector Crypt ships in [`cc-vrf`](https://vrf.collectorcrypt.com).

Randomness is committed before it is known (the pull address is the VRF input) and
publicly verifiable off-chain, so every pull is provably fair.

| Framework | Path |
| --- | --- |
| Pinocchio | [`./pinocchio`](./pinocchio) |

The Pinocchio example is a self-contained nested workspace: it pins its own toolchain
and dependencies and builds/tests via its own `justfile`.
