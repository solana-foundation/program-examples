import * as anchor from "@anchor-lang/core";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Keypair, PublicKey } from "@solana/web3.js";
import { BankrunProvider } from "anchor-bankrun";
import { startAnchor } from "solana-bankrun";
import IDL from "../target/idl/nft_minter.json" with { type: "json" };
import type { NftMinter } from "../target/types/nft_minter.ts";

const PROGRAM_ID = new PublicKey(IDL.address);
const METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

describe("NFT bankrun Minter", async () => {
  const context = await startAnchor(
    "",
    [
      { name: "nft_minter", programId: PROGRAM_ID },
      { name: "token_metadata", programId: METADATA_PROGRAM_ID },
    ],
    [],
  );
  const provider = new BankrunProvider(context);
  anchor.setProvider(provider);
  const payer = provider.wallet as anchor.Wallet;
  const program = new anchor.Program<NftMinter>(IDL, provider);

  // The metadata for our NFT
  const metadata = {
    name: "Homer NFT",
    symbol: "HOMR",
    uri: "https://raw.githubusercontent.com/solana-developers/program-examples/new-examples/tokens/tokens/.assets/nft.json",
  };

  it("Create an NFT!", async () => {
    // Generate a keypair to use as the address of our mint account
    const mintKeypair = new Keypair();

    // Derive the associated token address account for the mint and payer.
    const associatedTokenAccountAddress = getAssociatedTokenAddressSync(mintKeypair.publicKey, payer.publicKey);

    const transactionSignature = await program.methods
      .mintNft(metadata.name, metadata.symbol, metadata.uri)
      .accountsPartial({
        payer: payer.publicKey,
        mintAccount: mintKeypair.publicKey,
        associatedTokenAccount: associatedTokenAccountAddress,
      })
      .signers([mintKeypair])
      .rpc({ skipPreflight: true });

    console.log("Success!");
    console.log(`   Mint Address: ${mintKeypair.publicKey}`);
    console.log(`   Transaction Signature: ${transactionSignature}`);
  });
});
