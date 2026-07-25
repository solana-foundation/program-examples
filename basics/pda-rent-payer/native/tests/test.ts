import { Buffer } from "node:buffer";
import { before, describe, test } from "node:test";
import { Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import * as borsh from "borsh";
import { LiteSVM, TransactionMetadata } from "litesvm";

const MyInstruction = {
  InitRentVault: 0,
  CreateNewAccount: 1,
} as const;

const InitRentVaultSchema = {
  struct: {
    instruction: "u8",
    fund_lamports: "u64",
  },
};

const CreateNewAccountSchema = {
  struct: {
    instruction: "u8",
  },
};

function borshSerialize(schema: borsh.Schema, data: object): Buffer {
  return Buffer.from(borsh.serialize(schema, data));
}

describe("PDA Rent-Payer", () => {
  const PROGRAM_ID = PublicKey.unique();
  let svm: LiteSVM;
  let payer: Keypair;

  before(() => {
    svm = new LiteSVM();
    payer = Keypair.generate();
    svm.airdrop(payer.publicKey, BigInt(10_000_000_000));
    svm.addProgramFromFile(PROGRAM_ID, "./tests/fixtures/pda_rent_payer_program.so");
  });

  function deriveRentVaultPda() {
    const pda = PublicKey.findProgramAddressSync([Buffer.from("rent_vault")], PROGRAM_ID);
    console.log(`PDA: ${pda[0].toBase58()}`);
    return pda;
  }

  test("Initialize the Rent Vault", () => {
    const [rentVaultPda] = deriveRentVaultPda();
    const ix = new TransactionInstruction({
      keys: [
        { pubkey: rentVaultPda, isSigner: false, isWritable: true },
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: PROGRAM_ID,
      data: borshSerialize(InitRentVaultSchema, {
        instruction: MyInstruction.InitRentVault,
        fund_lamports: 1000000000,
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

  test("Create a new account using the Rent Vault", () => {
    const newAccount = Keypair.generate();
    const [rentVaultPda] = deriveRentVaultPda();
    const ix = new TransactionInstruction({
      keys: [
        { pubkey: newAccount.publicKey, isSigner: true, isWritable: true },
        { pubkey: rentVaultPda, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: PROGRAM_ID,
      data: borshSerialize(CreateNewAccountSchema, {
        instruction: MyInstruction.CreateNewAccount,
      }),
    });

    const tx = new Transaction();
    tx.recentBlockhash = svm.latestBlockhash();
    tx.add(ix).sign(payer, newAccount);

    const result = svm.sendTransaction(tx);
    if (!(result instanceof TransactionMetadata)) {
      throw new Error(`Transaction failed: ${JSON.stringify(result)}`);
    }
  });
});
