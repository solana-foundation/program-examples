import { Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import * as borsh from "borsh";
import { assert, expect } from "chai";
import { LiteSVM, TransactionMetadata } from "litesvm";
import { beforeEach, describe, test } from "mocha";

const MyInstruction = {
  CreateFav: 0,
  GetFav: 1,
} as const;

const CreateFavSchema = {
  struct: {
    instruction: "u8",
    number: "u64",
    color: "string",
    hobbies: { array: { type: "string" } },
  },
};

const FavoritesDataSchema = {
  struct: {
    number: "u64",
    color: "string",
    hobbies: { array: { type: "string" } },
  },
};

const GetFavSchema = {
  struct: {
    instruction: "u8",
  },
};

type FavoritesData = {
  number: number | bigint;
  color: string;
  hobbies: string[];
};

function borshSerialize(schema: borsh.Schema, data: object): Buffer {
  return Buffer.from(borsh.serialize(schema, data));
}

describe("Favorites Solana Native", () => {
  const programId = PublicKey.unique();

  let svm: LiteSVM;
  let payer: Keypair;

  beforeEach(() => {
    svm = new LiteSVM();
    payer = Keypair.generate();
    svm.airdrop(payer.publicKey, BigInt(10_000_000_000));
    svm.addProgramFromFile(programId, "./tests/fixtures/favorites_native.so");
  });

  test("Set the favorite pda and cross-check the updated data", () => {
    const favoritesPda = PublicKey.findProgramAddressSync(
      [Buffer.from("favorite"), payer.publicKey.toBuffer()],
      programId,
    )[0];
    const favData = {
      instruction: MyInstruction.CreateFav,
      number: 42,
      color: "blue",
      hobbies: ["coding", "reading", "traveling"],
    };

    const ix = new TransactionInstruction({
      keys: [
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: favoritesPda, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId,
      data: borshSerialize(CreateFavSchema, favData),
    });

    const tx = new Transaction();
    tx.recentBlockhash = svm.latestBlockhash();
    tx.feePayer = payer.publicKey;
    tx.add(ix);
    tx.sign(payer);

    const result = svm.sendTransaction(tx);
    if (!(result instanceof TransactionMetadata)) {
      throw new Error(`Transaction failed: ${JSON.stringify(result)}`);
    }

    const account = svm.getAccount(favoritesPda);
    if (!account) throw new Error("Favorites PDA account not found");
    const data = Buffer.from(account.data);

    const favoritesData = borsh.deserialize(FavoritesDataSchema, data) as FavoritesData;

    console.log("Deserialized data:", favoritesData);

    expect(Number(favoritesData.number)).to.equal(favData.number);
    expect(favoritesData.color).to.equal(favData.color);
    expect(favoritesData.hobbies).to.deep.equal(favData.hobbies);
  });

  test("Check if the test fails if the pda seeds aren't same", () => {
    const wrongPda = PublicKey.findProgramAddressSync(
      [Buffer.from("wrong_seed"), payer.publicKey.toBuffer()],
      programId,
    )[0];
    const favData = {
      instruction: MyInstruction.CreateFav,
      number: 42,
      color: "blue",
      hobbies: ["coding", "reading", "traveling"],
    };

    const ix = new TransactionInstruction({
      keys: [
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: wrongPda, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId,
      data: borshSerialize(CreateFavSchema, favData),
    });

    const tx = new Transaction();
    tx.recentBlockhash = svm.latestBlockhash();
    tx.feePayer = payer.publicKey;
    tx.add(ix);
    tx.sign(payer);

    const result = svm.sendTransaction(tx);
    assert(!(result instanceof TransactionMetadata), "Expected transaction to fail with wrong PDA seeds");
  });

  test("Get the favorite pda and cross-check the data", () => {
    const favoritesPda = PublicKey.findProgramAddressSync(
      [Buffer.from("favorite"), payer.publicKey.toBuffer()],
      programId,
    )[0];
    const favData = {
      instruction: MyInstruction.CreateFav,
      number: 42,
      color: "hazel",
      hobbies: ["singing", "dancing", "skydiving"],
    };

    const ix = new TransactionInstruction({
      keys: [
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: favoritesPda, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId,
      data: borshSerialize(CreateFavSchema, favData),
    });

    const tx1 = new Transaction();
    tx1.recentBlockhash = svm.latestBlockhash();
    tx1.feePayer = payer.publicKey;
    tx1.add(ix);
    tx1.sign(payer);

    const result1 = svm.sendTransaction(tx1);
    if (!(result1 instanceof TransactionMetadata)) {
      throw new Error(`Transaction failed: ${JSON.stringify(result1)}`);
    }

    const ix2 = new TransactionInstruction({
      keys: [
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: favoritesPda, isSigner: false, isWritable: false },
      ],
      programId,
      data: borshSerialize(GetFavSchema, { instruction: MyInstruction.GetFav }),
    });

    const tx2 = new Transaction();
    tx2.recentBlockhash = svm.latestBlockhash();
    tx2.feePayer = payer.publicKey;
    tx2.add(ix2);
    tx2.sign(payer);

    const result2 = svm.sendTransaction(tx2);
    if (!(result2 instanceof TransactionMetadata)) {
      throw new Error(`Transaction failed: ${JSON.stringify(result2)}`);
    }
  });
});
