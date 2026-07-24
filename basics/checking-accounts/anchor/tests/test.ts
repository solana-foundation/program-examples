import * as anchor from "@anchor-lang/core";
import { Keypair, SystemProgram, sendAndConfirmTransaction, Transaction } from "@solana/web3.js";
import type { CheckingAccountProgram } from "../target/types/checking_account_program.ts";

describe("Anchor example", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.CheckingAccountProgram as anchor.Program<CheckingAccountProgram>;
  const wallet = provider.wallet as anchor.Wallet;

  // We'll create this ahead of time.
  // Our program will try to modify it.
  const accountToChange = new Keypair();
  // Our program will create this.
  const accountToCreate = new Keypair();

  it("Create an account owned by our program", async () => {
    const instruction = SystemProgram.createAccount({
      fromPubkey: provider.wallet.publicKey,
      newAccountPubkey: accountToChange.publicKey,
      lamports: await provider.connection.getMinimumBalanceForRentExemption(0),
      space: 0,
      programId: program.programId, // Our program
    });

    const transaction = new Transaction().add(instruction);

    await sendAndConfirmTransaction(provider.connection, transaction, [wallet.payer, accountToChange]);
  });

  it("Check accounts", async () => {
    await program.methods
      .checkAccounts()
      .accounts({
        payer: wallet.publicKey,
        accountToCreate: accountToCreate.publicKey,
        accountToChange: accountToChange.publicKey,
      })
      .rpc();
  });
});
