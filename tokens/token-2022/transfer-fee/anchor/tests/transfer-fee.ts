import type { Program } from "@anchor-lang/core";
import * as anchor from "@anchor-lang/core";
import { ASSOCIATED_PROGRAM_ID } from "@anchor-lang/core/dist/cjs/utils/token";
import {
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import type { TransferFee } from "../target/types/transfer_fee";

describe("transfer-fee", () => {
  const provider = anchor.AnchorProvider.env();
  const connection = provider.connection;
  const wallet = provider.wallet as anchor.Wallet;
  anchor.setProvider(provider);

  const program = anchor.workspace.TransferFee as Program<TransferFee>;

  const mintKeypair = new anchor.web3.Keypair();
  const recipient = new anchor.web3.Keypair();

  const senderTokenAccountAddress = getAssociatedTokenAddressSync(
    mintKeypair.publicKey,
    wallet.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID,
  );

  const recipientTokenAccountAddress = getAssociatedTokenAddressSync(
    mintKeypair.publicKey,
    recipient.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID,
  );

  it("Create Mint with Transfer Fee", async () => {
    const transferFeeBasisPoints = 100;
    const maximumFee = 1;

    const transactionSignature = await program.methods
      .initialize(transferFeeBasisPoints, new anchor.BN(maximumFee))
      .accountsPartial({ mintAccount: mintKeypair.publicKey })
      .signers([mintKeypair])
      .rpc({ skipPreflight: true });
    console.log("Your transaction signature", transactionSignature);
  });

  it("Mint Tokens", async () => {
    await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      mintKeypair.publicKey,
      wallet.publicKey,
      false,
      null,
      null,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_PROGRAM_ID,
    );

    await mintTo(
      connection,
      wallet.payer,
      mintKeypair.publicKey,
      senderTokenAccountAddress,
      wallet.payer,
      300,
      [],
      null,
      TOKEN_2022_PROGRAM_ID,
    );
  });

  it("Transfer", async () => {
    const transactionSignature = await program.methods
      .transfer(new anchor.BN(100))
      .accountsPartial({
        sender: wallet.publicKey,
        recipient: recipient.publicKey,
        mintAccount: mintKeypair.publicKey,
        senderTokenAccount: senderTokenAccountAddress,
        recipientTokenAccount: recipientTokenAccountAddress,
      })
      .rpc({ skipPreflight: true });
    console.log("Your transaction signature", transactionSignature);
  });

  it("Transfer Again, fee limit by maximumFee", async () => {
    const transactionSignature = await program.methods
      .transfer(new anchor.BN(200))
      .accountsPartial({
        sender: wallet.publicKey,
        recipient: recipient.publicKey,
        mintAccount: mintKeypair.publicKey,
        senderTokenAccount: senderTokenAccountAddress,
        recipientTokenAccount: recipientTokenAccountAddress,
      })
      .rpc({ skipPreflight: true });
    console.log("Your transaction signature", transactionSignature);
  });

  it("Harvest Transfer Fees to Mint Account", async () => {
    const transactionSignature = await program.methods
      .harvest()
      .accountsPartial({ mintAccount: mintKeypair.publicKey })
      .remainingAccounts([
        {
          pubkey: recipientTokenAccountAddress,
          isSigner: false,
          isWritable: true,
        },
      ])
      .rpc({ skipPreflight: true });
    console.log("Your transaction signature", transactionSignature);
  });

  it("Withdraw Transfer Fees from Mint Account", async () => {
    const transactionSignature = await program.methods
      .withdraw()
      .accountsPartial({
        mintAccount: mintKeypair.publicKey,
        tokenAccount: senderTokenAccountAddress,
      })
      .rpc({ skipPreflight: true });
    console.log("Your transaction signature", transactionSignature);
  });

  it("Update Transfer Fee", async () => {
    const transferFeeBasisPoints = 0;
    const maximumFee = 0;

    const transactionSignature = await program.methods
      .updateFee(transferFeeBasisPoints, new anchor.BN(maximumFee))
      .accountsPartial({ mintAccount: mintKeypair.publicKey })
      .rpc({ skipPreflight: true });
    console.log("Your transaction signature", transactionSignature);
  });
});
