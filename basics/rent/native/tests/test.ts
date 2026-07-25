import { Buffer } from "node:buffer";
import { before, describe, test } from "node:test";
import { Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import * as borsh from "borsh";
import { LiteSVM, TransactionMetadata } from "litesvm";

const AddressDataSchema = {
  struct: {
    name: "string",
    address: "string",
  },
};

function borshSerialize(schema: borsh.Schema, data: object): Buffer {
  return Buffer.from(borsh.serialize(schema, data));
}

describe("Create a system account", () => {
  const PROGRAM_ID = PublicKey.unique();
  let svm: LiteSVM;
  let payer: Keypair;

  before(() => {
    svm = new LiteSVM();
    payer = Keypair.generate();
    svm.airdrop(payer.publicKey, BigInt(10_000_000_000));
    svm.addProgramFromFile(PROGRAM_ID, "./tests/fixtures/program.so");
  });

  test("Create the account", () => {
    const newKeypair = Keypair.generate();

    const addressData = {
      name: "Marcus",
      address: "123 Main St. San Francisco, CA",
    };

    const addressDataBuffer = borshSerialize(AddressDataSchema, addressData);
    console.log(`Address data buffer length: ${addressDataBuffer.length}`);

    const ix = new TransactionInstruction({
      keys: [
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: newKeypair.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: PROGRAM_ID,
      data: addressDataBuffer,
    });

    const tx = new Transaction();
    tx.recentBlockhash = svm.latestBlockhash();
    tx.add(ix).sign(payer, newKeypair);

    const result = svm.sendTransaction(tx);
    if (!(result instanceof TransactionMetadata)) {
      throw new Error(`Transaction failed: ${JSON.stringify(result)}`);
    }
  });
});
