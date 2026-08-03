# Solana Program cNFT Transfer example

This repo contains example code of how you can work with Metaplex compressed NFTs inside of Solana Anchor programs.

The basic idea is to allow for transfering cNFTs that are owned by a PDA account. So our program will have a vault (this PDA) that you can send cNFTs to manually and then withdraw them using the program instructions.

There are two instructions: one simple transfer that can withdraw one cNFT, and one instructions that can withdraw two cNFTs at the same time.

This program can be used as an inspiration on how to work with cNFTs in Solana programs.

## Components

The Anchor program can be found in the _programs_ folder and _tests_ some clientside tests. There are also some typescript node scripts in _tests/scripts_ to run them individually (plus there is one called _withdrawWithLookup.ts_ which demonstrates the use of the program with account lookup tables).

## Deployment

The program is deployed on devnet at `CNftyK7T8udPwYRzZUMWzbh79rKrz9a5GwV2wv7iEHpk`.
You can deploy it yourself by changing the respective values in lib.rs and Anchor.toml.

## Limitations

This is just an example implementation. It is missing all logic wheter a transfer should be performed or not (everyone can withdraw any cNFT in the vault).
Furthermore it is not optimized for using lowest possible compute. It is intended as a proof of concept and reference implemention only.

## Further resources

A video about the creation of this code which also contains further explanations has been publised on Solandy's YouTube channel:
https://youtu.be/qzr-q_E7H0M
