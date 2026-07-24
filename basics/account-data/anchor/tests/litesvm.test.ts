import { BorshCoder, type Idl } from "@anchor-lang/core";
import { Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { LiteSVM } from "litesvm";

import IDL from "../target/idl/account_data_anchor_program.json" with { type: "json" };

describe("Account Data!", () => {
  let litesvm: LiteSVM;
  let programId: PublicKey;
  let payer: Keypair;
  let addressInfoAccount: Keypair;
  const coder = new BorshCoder(IDL as Idl);

  before(() => {
    litesvm = new LiteSVM();
    programId = new PublicKey(IDL.address);
    payer = Keypair.generate();
    addressInfoAccount = Keypair.generate();

    const programPath = new URL("../target/deploy/account_data_anchor_program.so", import.meta.url).pathname;
    litesvm.addProgramFromFile(programId, programPath);

    litesvm.airdrop(payer.publicKey, BigInt(100000000000));
  });

  it("Create the address info account", () => {
    console.log(`Payer Address      : ${payer.publicKey}`);
    console.log(`Address Info Acct  : ${addressInfoAccount.publicKey}`);

    // Instruction Ix data
    const addressInfoIns = {
      name: "Joe C",
      house_number: 136,
      street: "Mile High Dr.",
      city: "Solana Beach",
    };

    /**
     * Convert into buffer and encode of instruction and arguments
     */
    const data = coder.instruction.encode("create_address_info", addressInfoIns);

    /**
     * Create Transactions
     */

    const ix = new TransactionInstruction({
      keys: [
        {
          pubkey: payer.publicKey,
          isSigner: true,
          isWritable: true,
        },
        {
          pubkey: addressInfoAccount.publicKey,
          isSigner: true,
          isWritable: true,
        },
        {
          pubkey: SystemProgram.programId,
          isSigner: false,
          isWritable: false,
        },
      ],
      programId,
      data,
    });

    const tx = new Transaction().add(ix);
    tx.feePayer = payer.publicKey;
    tx.recentBlockhash = litesvm.latestBlockhash();
    tx.sign(payer, addressInfoAccount);
    const _res = litesvm.sendTransaction(tx);
    // console.log(res.toString());
  });
  it("Read the new account's data", () => {
    const accountInfoAcc = litesvm.getAccount(addressInfoAccount.publicKey);
    if (!accountInfoAcc) {
      throw new Error("Failed to fetch account info");
    }

    /**
     * Decode the accounts' data
     */
    const addressInfo = coder.accounts.decode("AddressInfo", Buffer.from(accountInfoAcc.data));

    console.log(`Name     : ${addressInfo.name}`);
    console.log(`House Num: ${addressInfo.house_number}`);
    console.log(`Street   : ${addressInfo.street}`);
    console.log(`City     : ${addressInfo.city}`);
  });
});
