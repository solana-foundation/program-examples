import { Buffer } from "node:buffer";
import { before, describe, test } from "node:test";
import { Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import * as borsh from "borsh";
import { LiteSVM, TransactionMetadata } from "litesvm";

const PageVisitsSchema = {
  struct: {
    page_visits: "u32",
    bump: "u8",
  },
};

const IncrementPageVisitsSchema = { struct: {} };

function borshSerialize(schema: borsh.Schema, data: object): Buffer {
  return Buffer.from(borsh.serialize(schema, data));
}

describe("PDAs", () => {
  const PROGRAM_ID = PublicKey.unique();
  const testUser = Keypair.generate();
  let svm: LiteSVM;
  let payer: Keypair;

  before(() => {
    svm = new LiteSVM();
    payer = Keypair.generate();
    svm.airdrop(payer.publicKey, BigInt(10_000_000_000));
    svm.addProgramFromFile(PROGRAM_ID, "./tests/fixtures/program_derived_addresses_native_program.so");
  });

  function derivePageVisitsPda(userPubkey: PublicKey) {
    return PublicKey.findProgramAddressSync([Buffer.from("page_visits"), userPubkey.toBuffer()], PROGRAM_ID);
  }

  test("Create a test user", () => {
    const ix = SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      lamports: 1_000_000_000,
      newAccountPubkey: testUser.publicKey,
      programId: SystemProgram.programId,
      space: 0,
    });

    const tx = new Transaction();
    tx.recentBlockhash = svm.latestBlockhash();
    tx.add(ix).sign(payer, testUser);

    const result = svm.sendTransaction(tx);
    if (!(result instanceof TransactionMetadata)) {
      throw new Error(`Transaction failed: ${JSON.stringify(result)}`);
    }
    console.log(`Local Wallet: ${payer.publicKey}`);
    console.log(`Created User: ${testUser.publicKey}`);
  });

  test("Create the page visits tracking PDA", () => {
    const [pageVisitsPda, pageVisitsBump] = derivePageVisitsPda(testUser.publicKey);
    const ix = new TransactionInstruction({
      keys: [
        { pubkey: pageVisitsPda, isSigner: false, isWritable: true },
        { pubkey: testUser.publicKey, isSigner: false, isWritable: false },
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: PROGRAM_ID,
      data: borshSerialize(PageVisitsSchema, {
        page_visits: 0,
        bump: pageVisitsBump,
      }),
    });
    const tx = new Transaction();
    tx.recentBlockhash = svm.latestBlockhash();
    tx.add(ix).sign(payer);

    const result = svm.sendTransaction(tx);
    if (!(result instanceof TransactionMetadata)) {
      throw new Error(`Transaction failed: ${JSON.stringify(result)}`);
    }
  });

  test("Visit the page! (1)", () => {
    const [pageVisitsPda] = derivePageVisitsPda(testUser.publicKey);
    const ix = new TransactionInstruction({
      keys: [
        { pubkey: pageVisitsPda, isSigner: false, isWritable: true },
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      ],
      programId: PROGRAM_ID,
      data: borshSerialize(IncrementPageVisitsSchema, {}),
    });
    const tx = new Transaction();
    tx.recentBlockhash = svm.latestBlockhash();
    tx.add(ix).sign(payer);

    const result = svm.sendTransaction(tx);
    if (!(result instanceof TransactionMetadata)) {
      throw new Error(`Transaction failed: ${JSON.stringify(result)}`);
    }
  });

  test("Visit the page! (2)", () => {
    svm.expireBlockhash();
    const [pageVisitsPda] = derivePageVisitsPda(testUser.publicKey);
    const ix = new TransactionInstruction({
      keys: [
        { pubkey: pageVisitsPda, isSigner: false, isWritable: true },
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      ],
      programId: PROGRAM_ID,
      data: borshSerialize(IncrementPageVisitsSchema, {}),
    });
    const tx = new Transaction();
    tx.recentBlockhash = svm.latestBlockhash();
    tx.add(ix).sign(payer);

    const result = svm.sendTransaction(tx);
    if (!(result instanceof TransactionMetadata)) {
      throw new Error(`Transaction failed: ${JSON.stringify(result)}`);
    }
  });

  test("Read page visits", () => {
    const [pageVisitsPda] = derivePageVisitsPda(testUser.publicKey);
    const accountInfo = svm.getAccount(pageVisitsPda);
    if (!accountInfo) throw new Error("Page visits PDA account not found");
    const readPageVisits = borsh.deserialize(PageVisitsSchema, Buffer.from(accountInfo.data)) as {
      page_visits: number;
      bump: number;
    };
    console.log(`Number of page visits: ${readPageVisits.page_visits}`);
  });
});
