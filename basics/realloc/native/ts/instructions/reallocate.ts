import { Buffer } from "node:buffer";
import { type PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import * as borsh from "borsh";
import { ReallocInstruction } from "./instruction";

const ReallocateWithoutZeroInitSchema = {
  struct: {
    instruction: "u8",
    state: "string",
    zip: "u32",
  },
} as const;

export function createReallocateWithoutZeroInitInstruction(
  target: PublicKey,
  payer: PublicKey,
  programId: PublicKey,
  state: string,
  zip: number,
): TransactionInstruction {
  const data = Buffer.from(
    borsh.serialize(ReallocateWithoutZeroInitSchema, {
      instruction: ReallocInstruction.ReallocateWithoutZeroInit,
      state,
      zip,
    }),
  );

  return new TransactionInstruction({
    keys: [
      { pubkey: target, isSigner: false, isWritable: true },
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId,
    data,
  });
}

const ReallocateZeroInitSchema = {
  struct: {
    instruction: "u8",
    name: "string",
    position: "string",
    company: "string",
    years_employed: "u8",
  },
} as const;

export function createReallocateZeroInitInstruction(
  target: PublicKey,
  _payer: PublicKey,
  programId: PublicKey,
  name: string,
  position: string,
  company: string,
  years_employed: number,
): TransactionInstruction {
  const data = Buffer.from(
    borsh.serialize(ReallocateZeroInitSchema, {
      instruction: ReallocInstruction.ReallocateZeroInit,
      name,
      position,
      company,
      years_employed,
    }),
  );

  return new TransactionInstruction({
    keys: [{ pubkey: target, isSigner: false, isWritable: true }],
    programId,
    data,
  });
}
