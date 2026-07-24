import * as anchor from "@anchor-lang/core";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { BN } from "bn.js";
import type { TokenMinter } from "../target/types/token_minter";

describe("NFT Minter", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const payer = provider.wallet as anchor.Wallet;
  const program = anchor.workspace.TokenMinter as anchor.Program<TokenMinter>;

  // Derive the PDA to use as mint account address.
  // This same PDA is also used as the mint authority.
  const [mintPDA] = PublicKey.findProgramAddressSync([Buffer.from("mint")], program.programId);

  const metadata = {
    name: "Solana Gold",
    symbol: "GOLDSOL",
    uri: "https://raw.githubusercontent.com/solana-developers/program-examples/new-examples/tokens/tokens/.assets/spl-token.json",
  };

  it("Create a token!", async () => {
    const transactionSignature = await program.methods
      .createToken(metadata.name, metadata.symbol, metadata.uri)
      .accountsPartial({
        payer: payer.publicKey,
      })
      .rpc();

    console.log("Success!");
    console.log(`   Mint Address: ${mintPDA}`);
    console.log(`   Transaction Signature: ${transactionSignature}`);
  });

  it("Mint 1 Token!", async () => {
    // Derive the associated token address account for the mint and payer.
    const associatedTokenAccountAddress = getAssociatedTokenAddressSync(mintPDA, payer.publicKey);

    // Amount of tokens to mint.
    const amount = new BN(100);

    const transactionSignature = await program.methods
      .mintToken(amount)
      .accountsPartial({
        payer: payer.publicKey,
        associatedTokenAccount: associatedTokenAccountAddress,
      })
      .rpc();

    console.log("Success!");
    console.log(`   Associated Token Account Address: ${associatedTokenAccountAddress}`);
    console.log(`   Transaction Signature: ${transactionSignature}`);
  });
});
