import assert from "node:assert";
import { describe, test } from "node:test";
import { PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { start } from "solana-bankrun";

describe("hello-solana", async () => {
  // load program in solana-bankrun
  const PROGRAM_ID = PublicKey.unique();
  const context = await start([{ name: "hello_solana_program", programId: PROGRAM_ID }], []);
  const client = context.banksClient;
  const payer = context.payer;

  test("Say hello!", async () => {
    const blockhash = context.lastBlockhash;
    // We set up our instruction first.
    const ix = new TransactionInstruction({
      keys: [{ pubkey: payer.publicKey, isSigner: true, isWritable: true }],
      programId: PROGRAM_ID,
      data: Buffer.alloc(0), // No data
    });

    const tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.add(ix).sign(payer);

    // Now we process the transaction
    const transaction = await client.processTransaction(tx);

    assert(transaction.logMessages[0].startsWith(`Program ${PROGRAM_ID}`));
    assert(transaction.logMessages[1] === "Program log: Hello, Solana!");
    assert(transaction.logMessages[2] === `Program log: Our program's Program ID: ${PROGRAM_ID}`);
    assert(transaction.logMessages[3].startsWith(`Program ${PROGRAM_ID} consumed`));
    assert(transaction.logMessages[4] === `Program ${PROGRAM_ID} success`);
    assert(transaction.logMessages.length === 5);
  });
});
