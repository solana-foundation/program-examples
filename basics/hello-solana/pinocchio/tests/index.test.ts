import assert from "node:assert";
import { before, describe, test } from "node:test";
import { PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { type ProgramTestContext, start } from "solana-bankrun";

describe("hello-solana", () => {
  const PROGRAM_ID = PublicKey.unique();

  // load program in solana-bankrun
  let context: ProgramTestContext;
  before(async () => {
    context = await start([{ name: "hello_solana_program_pinocchio", programId: PROGRAM_ID }], []);
  });

  test("Say hello!", async () => {
    const client = context.banksClient;
    const payer = context.payer;
    const blockhash = context.lastBlockhash;
    // We set up our instruction first.
    const ix = new TransactionInstruction({
      keys: [{ pubkey: payer.publicKey, isSigner: true, isWritable: true }],
      programId: PROGRAM_ID,
      data: Buffer.from([]), // No data
    });

    const tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.add(ix).sign(payer);

    // Now we process the transaction
    const transaction = await client.processTransaction(tx);

    assert(transaction.logMessages[0].startsWith(`Program ${PROGRAM_ID}`));
    assert(transaction.logMessages[1] === "Program log: Hello, Solana!");
    assert(transaction.logMessages[2] === `Program log: [${Array.from(PROGRAM_ID.toBytes()).join(", ")}]`);
    assert(transaction.logMessages[3].startsWith(`Program ${PROGRAM_ID} consumed`));
    assert(transaction.logMessages[4] === `Program ${PROGRAM_ID} success`);
    assert(transaction.logMessages.length === 5);
  });
});
