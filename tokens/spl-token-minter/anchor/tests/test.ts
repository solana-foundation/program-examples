import * as anchor from "@anchor-lang/core";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Keypair } from "@solana/web3.js";
import { BN } from "bn.js";
import type { SplTokenMinter } from "../target/types/spl_token_minter";

describe("SPL Token Minter", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const payer = provider.wallet as anchor.Wallet;
  const program = anchor.workspace.SplTokenMinter as anchor.Program<SplTokenMinter>;

  const metadata = {
    name: "Solana Gold",
    symbol: "GOLDSOL",
    uri: "https://raw.githubusercontent.com/solana-developers/program-examples/new-examples/tokens/tokens/.assets/spl-token.json",
  };

  // Generate new keypair to use as address for mint account.
  const mintKeypair = new Keypair();

  it("Create an SPL Token!", async () => {
    const transactionSignature = await program.methods
      .createToken(metadata.name, metadata.symbol, metadata.uri)
      .accountsPartial({
        payer: payer.publicKey,
        mintAccount: mintKeypair.publicKey,
      })
      .signers([mintKeypair])
      .rpc();

    console.log("Success!");
    console.log(`   Mint Address: ${mintKeypair.publicKey}`);
    console.log(`   Transaction Signature: ${transactionSignature}`);
  });

  it("Mint some tokens to your wallet!", async () => {
    // Derive the associated token address account for the mint and payer.
    const associatedTokenAccountAddress = getAssociatedTokenAddressSync(mintKeypair.publicKey, payer.publicKey);

    // Amount of tokens to mint.
    const amount = new BN(100);

    // Mint the tokens to the associated token account.
    const transactionSignature = await program.methods
      .mintToken(amount)
      .accountsPartial({
        mintAuthority: payer.publicKey,
        recipient: payer.publicKey,
        mintAccount: mintKeypair.publicKey,
        associatedTokenAccount: associatedTokenAccountAddress,
      })
      .rpc();

    console.log("Success!");
    console.log(`   Associated Token Account Address: ${associatedTokenAccountAddress}`);
    console.log(`   Transaction Signature: ${transactionSignature}`);
  });
});
