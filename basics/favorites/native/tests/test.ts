import {
  type Blockhash,
  type Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import * as borsh from "borsh";
import { assert, expect } from "chai";
import { describe, test } from "mocha";
import { type BanksClient, type ProgramTestContext, start } from "solana-bankrun";

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
  // Randomly generate the program keypair and load the program to solana-bankrun
  const programId = PublicKey.unique();

  let context: ProgramTestContext;
  let client: BanksClient;
  let payer: Keypair;
  let blockhash: Blockhash;

  beforeEach(async () => {
    context = await start([{ name: "favorites_native", programId }], []);
    client = context.banksClient;
    // Get the payer keypair from the context, this will be used to sign transactions with enough lamports
    payer = context.payer;
    blockhash = context.lastBlockhash;
  });

  test("Set the favorite pda and cross-check the updated data", async () => {
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

    const tx = new Transaction().add(ix);
    tx.feePayer = payer.publicKey;
    tx.recentBlockhash = blockhash;
    tx.sign(payer);
    tx.recentBlockhash = blockhash;
    await client.processTransaction(tx);

    const account = await client.getAccount(favoritesPda);
    const data = Buffer.from(account.data);

    const favoritesData = borsh.deserialize(FavoritesDataSchema, data) as FavoritesData;

    console.log("Deserialized data:", favoritesData);

    expect(Number(favoritesData.number)).to.equal(favData.number);
    expect(favoritesData.color).to.equal(favData.color);
    expect(favoritesData.hobbies).to.deep.equal(favData.hobbies);
  });

  test("Check if the test fails if the pda seeds aren't same", async () => {
    // Derive a PDA using WRONG seeds so the program's on-chain seed check rejects it
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

    const tx = new Transaction().add(ix);
    tx.feePayer = payer.publicKey;
    tx.recentBlockhash = blockhash;
    tx.sign(payer);
    tx.recentBlockhash = blockhash;
    let threw = false;
    try {
      await client.processTransaction(tx);
    } catch (_err) {
      threw = true;
    }
    assert(threw, "Expected transaction to fail with wrong PDA seeds");
  });

  test("Get the favorite pda and cross-check the data", async () => {
    // Creating a new account with payer's pubkey
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

    const tx1 = new Transaction().add(ix);
    tx1.feePayer = payer.publicKey;
    tx1.recentBlockhash = blockhash;
    tx1.sign(payer);
    tx1.recentBlockhash = blockhash;
    await client.processTransaction(tx1);

    // Getting the user's data through the get_pda instruction
    const ix2 = new TransactionInstruction({
      keys: [
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: favoritesPda, isSigner: false, isWritable: false },
      ],
      programId,
      data: borshSerialize(GetFavSchema, { instruction: MyInstruction.GetFav }),
    });

    const tx = new Transaction().add(ix2);
    tx.feePayer = payer.publicKey;
    tx.recentBlockhash = blockhash;
    tx.sign(payer);
    tx.recentBlockhash = blockhash;
    await client.processTransaction(tx);
  });
});
