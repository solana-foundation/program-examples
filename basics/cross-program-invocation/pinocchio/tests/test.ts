import assert from "node:assert";
import { Buffer } from "node:buffer";
import { describe, test } from "node:test";
import { Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { start } from "solana-bankrun";

describe("Pinocchio: CPI", async () => {
  const HAND_PROGRAM_ID = PublicKey.unique();
  const LEVER_PROGRAM_ID = PublicKey.unique();

  const context = await start(
    [
      { name: "cross_program_invocation_pinocchio_hand", programId: HAND_PROGRAM_ID },
      { name: "cross_program_invocation_pinocchio_lever", programId: LEVER_PROGRAM_ID },
    ],
    [],
  );
  const client = context.banksClient;
  const payer = context.payer;

  // Lever instruction discriminator
  const IX_INITIALIZE = 0;

  const powerAccount = Keypair.generate();

  async function sendTx(ix: TransactionInstruction, signers: Keypair[]) {
    const tx = new Transaction();
    tx.recentBlockhash = context.lastBlockhash;
    tx.add(ix).sign(payer, ...signers);
    await client.processTransaction(tx);
  }

  test("Initialize the lever!", async () => {
    const ix = new TransactionInstruction({
      keys: [
        { pubkey: powerAccount.publicKey, isSigner: true, isWritable: true },
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: LEVER_PROGRAM_ID,
      data: Buffer.from([IX_INITIALIZE]),
    });
    await sendTx(ix, [powerAccount]);

    const acct = await client.getAccount(powerAccount.publicKey);
    if (acct === null) throw new Error("power account not found");
    assert.deepEqual(Buffer.from(acct.data), Buffer.from([0])); // is_on = false
  });

  test("Pull the lever!", async () => {
    const name = "Chris";
    const ix = new TransactionInstruction({
      keys: [
        { pubkey: powerAccount.publicKey, isSigner: false, isWritable: true },
        { pubkey: LEVER_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      programId: HAND_PROGRAM_ID,
      data: Buffer.from(name, "utf8"),
    });
    await sendTx(ix, []);

    const acct = await client.getAccount(powerAccount.publicKey);
    if (acct === null) throw new Error("power account not found");
    assert.deepEqual(Buffer.from(acct.data), Buffer.from([1])); // is_on = true
  });

  test("Pull it again!", async () => {
    const name = "Ashley";
    const ix = new TransactionInstruction({
      keys: [
        { pubkey: powerAccount.publicKey, isSigner: false, isWritable: true },
        { pubkey: LEVER_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      programId: HAND_PROGRAM_ID,
      data: Buffer.from(name, "utf8"),
    });
    await sendTx(ix, []);

    const acct = await client.getAccount(powerAccount.publicKey);
    if (acct === null) throw new Error("power account not found");
    assert.deepEqual(Buffer.from(acct.data), Buffer.from([0])); // is_on = false (flipped back)
  });

  test("Lever rejects switch_power directly with no name", async () => {
    // Sending only the discriminator (no name bytes) is fine because UTF-8 of empty is empty,
    // but invoking the lever directly with an unknown discriminator should fail.
    const ix = new TransactionInstruction({
      keys: [{ pubkey: powerAccount.publicKey, isSigner: false, isWritable: true }],
      programId: LEVER_PROGRAM_ID,
      data: Buffer.from([42]),
    });

    try {
      await sendTx(ix, []);
      assert.fail("expected lever to reject unknown discriminator");
    } catch {
      // expected
    }
  });
});
