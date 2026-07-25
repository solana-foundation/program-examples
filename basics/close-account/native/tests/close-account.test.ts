import { before, describe, test } from "node:test";
import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { LiteSVM, TransactionMetadata } from "litesvm";
import { createCloseUserInstruction, createCreateUserInstruction } from "../ts";

describe("Close Account!", () => {
  const PROGRAM_ID = PublicKey.unique();
  let svm: LiteSVM;
  let payer: Keypair;
  let testAccountPublicKey: PublicKey;

  before(() => {
    svm = new LiteSVM();
    payer = Keypair.generate();
    svm.airdrop(payer.publicKey, BigInt(10_000_000_000));
    svm.addProgramFromFile(PROGRAM_ID, "./tests/fixtures/close_account_native_program.so");
    testAccountPublicKey = PublicKey.findProgramAddressSync(
      [Buffer.from("USER"), payer.publicKey.toBuffer()],
      PROGRAM_ID,
    )[0];
  });

  test("Create the account", () => {
    const ix = createCreateUserInstruction(testAccountPublicKey, payer.publicKey, PROGRAM_ID, "Jacob");

    const tx = new Transaction();
    tx.recentBlockhash = svm.latestBlockhash();
    tx.add(ix).sign(payer);

    const result = svm.sendTransaction(tx);
    if (!(result instanceof TransactionMetadata)) {
      throw new Error(`Transaction failed: ${JSON.stringify(result)}`);
    }
  });

  test("Close the account", () => {
    const ix = createCloseUserInstruction(testAccountPublicKey, payer.publicKey, PROGRAM_ID);
    const tx = new Transaction();
    tx.recentBlockhash = svm.latestBlockhash();
    tx.add(ix).sign(payer);

    const result = svm.sendTransaction(tx);
    if (!(result instanceof TransactionMetadata)) {
      throw new Error(`Transaction failed: ${JSON.stringify(result)}`);
    }
  });
});
