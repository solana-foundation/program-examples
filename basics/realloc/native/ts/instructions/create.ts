import { Buffer } from "node:buffer";
import { type PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import * as borsh from "borsh";
import { ReallocInstruction } from "./instruction";

const CreateSchema = {
  struct: {
    instruction: "u8",
    name: "string",
    house_number: "u8",
    street: "string",
    city: "string",
  },
} as const;

export function createCreateInstruction(
  target: PublicKey,
  payer: PublicKey,
  programId: PublicKey,
  name: string,
  house_number: number,
  street: string,
  city: string,
): TransactionInstruction {
  const data = Buffer.from(
    borsh.serialize(CreateSchema, {
      instruction: ReallocInstruction.Create,
      name,
      house_number,
      street,
      city,
    }),
  );

  return new TransactionInstruction({
    keys: [
      { pubkey: target, isSigner: true, isWritable: true },
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId,
    data,
  });
}
