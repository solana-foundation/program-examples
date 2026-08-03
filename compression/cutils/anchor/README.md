# Solana Program cNFT utils

This repo contains example code of how you can work with Metaplex compressed NFTs inside of Solana Anchor programs.

The basic idea is to allow for custom logic in your own Solana program by doing a CPI to the bubblegum minting instruction. Two instructions:

1. **mint**: mints a cNFT to your collection by doing a CPI to bubblegum. You could initialise your own program-specific PDA in this instruction
2. **verify**: verifies that the owner of the cNFT did in fact actuate the instruction. This is more of a utility function, which is to be used for future program-specific use-cases.

This program can be used as an inspiration on how to work with cNFTs in Solana programs.

## Components

- **programs**: the Solana program
    - There is a validate/actuate setup which allows you to validate some constraints through an `access_control` macro. This might be useful to use in conjunction with the cNFT verification logic.

- **tests**:
    - `setup.ts` which is to be executed first if you don't already have a collection with merkle tree(s).
    - `tests.ts` for running individual minting and verification tests

## Deployment

The program is deployed on devnet at `burZc1SfqbrAP35XG63YZZ82C9Zd22QUwhCXoEUZWNF`.
You can deploy it yourself by changing the respective values in lib.rs and Anchor.toml.

## Limitations

This is just an example implementation. Use at your own discretion

**This only works on anchor 0.26.0 for now due to mpl-bubblegum dependencies**

## Further resources

A video about the creation of this code which also contains further explanations has been publised on Burger Bob's YouTube channel: COMING SOON

## How-to

1. Configure RPC path in _utils/readAPI.ts_. Personal preference: Helius RPCs.
2. cd root folder
3. Install packages: `yarn`
4. Optional: run `npx ts-node tests/setup.ts` to setup a NFT collection and its underlying merkle tree.
5. Comment-out the tests you don't want to execute in `tests/tests.ts`
6. If minting, change to your appropriate NFT uri
7. If verifying, change to your appropriate assetId (cNFT mint address)
8. Run `anchor test --skip-build --skip-deploy --skip-local-validator`
9. You can check your cNFTs on devnet through the Solflare wallet (thanks [@SolPlay_jonas](https://twitter.com/SolPlay_jonas))
10. You might want to change the wallet-path in `Anchor.toml`

## Acknowledgements

This repo would not have been possible without the work of:

- [@nickfrosty](https://twitter.com/nickfrosty) for providing sample code and doing a live demo [here](https://youtu.be/LxhTxS9DexU)
- [@HeyAndyS](https://twitter.com/HeyAndyS) for laying the groundwork with cnft-vault
- The kind folks responding to this [thread](https://twitter.com/burger606/status/1669289672076320771?s=20)
- [Switchboard VRF-flip](https://github.com/switchboard-xyz/vrf-flip/tree/main/client) for inspiring the validate/actuate setup.
