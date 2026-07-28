import assert from "node:assert";
import { Buffer } from "node:buffer";
import { before, describe, test } from "node:test";
import { Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { LiteSVM, TransactionMetadata } from "litesvm";

describe("Pinocchio: CPI", () => {
  const HAND_PROGRAM_ID = PublicKey.unique();
  const LEVER_PROGRAM_ID = PublicKey.unique();
  const powerAccount = Keypair.generate();
  let svm: LiteSVM;
  let payer: Keypair;

  // Lever instruction discriminator
  const IX_INITIALIZE = 0;

  before(() => {
    svm = new LiteSVM();
    payer = Keypair.generate();
    svm.airdrop(payer.publicKey, BigInt(10_000_000_000));
    svm.addProgramFromFile(LEVER_PROGRAM_ID, "./tests/fixtures/cross_program_invocation_pinocchio_lever.so");
    svm.addProgramFromFile(HAND_PROGRAM_ID, "./tests/fixtures/cross_program_invocation_pinocchio_hand.so");
  });

  function sendTx(ix: TransactionInstruction, signers: Keypair[]): TransactionMetadata {
    const tx = new Transaction();
    tx.recentBlockhash = svm.latestBlockhash();
    tx.add(ix).sign(payer, ...signers);
    const result = svm.sendTransaction(tx);
    if (!(result instanceof TransactionMetadata)) {
      throw new Error(`Transaction failed: ${JSON.stringify(result)}`);
    }
    return result;
  }

  test("Initialize the lever!", () => {
    const ix = new TransactionInstruction({
      keys: [
        { pubkey: powerAccount.publicKey, isSigner: true, isWritable: true },
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: LEVER_PROGRAM_ID,
      data: Buffer.from([IX_INITIALIZE]),
    });
    sendTx(ix, [powerAccount]);

    const acct = svm.getAccount(powerAccount.publicKey);
    if (acct === null) throw new Error("power account not found");
    assert.deepEqual(Buffer.from(acct.data), Buffer.from([0])); // is_on = false
  });

  test("Pull the lever!", () => {
    svm.expireBlockhash();
    const name = "Chris";
    const ix = new TransactionInstruction({
      keys: [
        { pubkey: powerAccount.publicKey, isSigner: false, isWritable: true },
        { pubkey: LEVER_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      programId: HAND_PROGRAM_ID,
      data: Buffer.from(name, "utf8"),
    });
    sendTx(ix, []);

    const acct = svm.getAccount(powerAccount.publicKey);
    if (acct === null) throw new Error("power account not found");
    assert.deepEqual(Buffer.from(acct.data), Buffer.from([1])); // is_on = true
  });

  test("Pull it again!", () => {
    svm.expireBlockhash();
    const name = "Ashley";
    const ix = new TransactionInstruction({
      keys: [
        { pubkey: powerAccount.publicKey, isSigner: false, isWritable: true },
        { pubkey: LEVER_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      programId: HAND_PROGRAM_ID,
      data: Buffer.from(name, "utf8"),
    });
    sendTx(ix, []);

    const acct = svm.getAccount(powerAccount.publicKey);
    if (acct === null) throw new Error("power account not found");
    assert.deepEqual(Buffer.from(acct.data), Buffer.from([0])); // is_on = false (flipped back)
  });

  test("Lever rejects switch_power directly with no name", () => {
    svm.expireBlockhash();
    const ix = new TransactionInstruction({
      keys: [{ pubkey: powerAccount.publicKey, isSigner: false, isWritable: true }],
      programId: LEVER_PROGRAM_ID,
      data: Buffer.from([42]),
    });

    const tx = new Transaction();
    tx.recentBlockhash = svm.latestBlockhash();
    tx.add(ix).sign(payer);
    const result = svm.sendTransaction(tx);
    assert(!(result instanceof TransactionMetadata), "expected lever to reject unknown discriminator");
  });
});
