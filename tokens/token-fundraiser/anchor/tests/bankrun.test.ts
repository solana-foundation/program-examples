import assert from "node:assert";
import { describe, it } from "node:test";
import * as anchor from "@anchor-lang/core";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { BankrunProvider } from "anchor-bankrun";
import BN from "bn.js";
import { Clock, startAnchor } from "solana-bankrun";
import IDL from "../target/idl/fundraiser.json";
import type { Fundraiser } from "../target/types/fundraiser";

const PROGRAM_ID = new PublicKey(IDL.address);

describe("fundraiser bankrun", async () => {
  const context = await startAnchor("", [{ name: "fundraiser", programId: PROGRAM_ID }], []);
  const provider = new BankrunProvider(context);
  anchor.setProvider(provider);
  const wallet = provider.wallet as anchor.Wallet;
  const program = new anchor.Program<Fundraiser>(IDL, provider);

  const maker = anchor.web3.Keypair.generate();

  let mint: anchor.web3.PublicKey;

  let contributorATA: anchor.web3.PublicKey;

  let makerATA: anchor.web3.PublicKey;

  const fundraiser = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("fundraiser"), maker.publicKey.toBuffer()],
    program.programId,
  )[0];

  const contributor = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("contributor"), fundraiser.toBuffer(), provider.publicKey.toBuffer()],
    program.programId,
  )[0];

  const confirm = async (signature: string): Promise<string> => {
    const block = await provider.connection.getLatestBlockhash();
    await provider.connection.confirmTransaction({
      signature,
      ...block,
    });
    return signature;
  };

  // Pin the bankrun clock to a deterministic point in the campaign so the
  // day-based time gates are exercised regardless of the runtime's default
  // clock behaviour: `days` days after the fundraiser's recorded start time.
  const setElapsedDays = async (days: number) => {
    const state = await program.account.fundraiser.fetch(fundraiser);
    const clock = await context.banksClient.getClock();
    context.setClock(
      new Clock(
        clock.slot,
        clock.epochStartTimestamp,
        clock.epoch,
        clock.leaderScheduleEpoch,
        BigInt(state.timeStarted.toString()) + BigInt(days * 24 * 60 * 60),
      ),
    );
  };

  it("Test Preparation", async () => {
    const airdrop = await provider.connection
      .requestAirdrop(maker.publicKey, 1 * anchor.web3.LAMPORTS_PER_SOL)
      .then(confirm);
    console.log("\nAirdropped 1 SOL to maker", airdrop);

    mint = await createMint(provider.connection, wallet.payer, provider.publicKey, provider.publicKey, 6);
    console.log("Mint created", mint.toBase58());

    contributorATA = (
      await getOrCreateAssociatedTokenAccount(provider.connection, wallet.payer, mint, wallet.publicKey)
    ).address;

    makerATA = (await getOrCreateAssociatedTokenAccount(provider.connection, wallet.payer, mint, maker.publicKey))
      .address;

    const mintTx = await mintTo(
      provider.connection,
      wallet.payer,
      mint,
      contributorATA,
      provider.publicKey,
      1_000_000_0,
    );
    console.log("Minted 10 tokens to contributor", mintTx);
  });

  it("Initialize Fundaraiser", async () => {
    const vault = getAssociatedTokenAddressSync(mint, fundraiser, true);

    const tx = await program.methods
      .initialize(new BN(30000000), 5)
      .accountsPartial({
        maker: maker.publicKey,
        fundraiser,
        mintToRaise: mint,
        vault,
        systemProgram: anchor.web3.SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .signers([maker])
      .rpc()
      .then(confirm);

    console.log("\nInitialized fundraiser Account");
    console.log("Your transaction signature", tx);

    // Place "now" one day into the 5-day campaign so contributions are open.
    await setElapsedDays(1);
  });

  it("Contribute to Fundraiser", async () => {
    const vault = getAssociatedTokenAddressSync(mint, fundraiser, true);

    const tx = await program.methods
      .contribute(new BN(1000000))
      .accountsPartial({
        contributor: provider.publicKey,
        fundraiser,
        contributorAccount: contributor,
        contributorAta: contributorATA,
        vault,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc()
      .then(confirm);

    console.log("\nContributed to fundraiser", tx);
    console.log("Your transaction signature", tx);
    console.log("Vault balance", (await provider.connection.getTokenAccountBalance(vault)).value.amount);

    const contributorAccount = await program.account.contributor.fetch(contributor);
    console.log("Contributor balance", contributorAccount.amount.toString());
  });
  it("Contribute to Fundraiser", async () => {
    const vault = getAssociatedTokenAddressSync(mint, fundraiser, true);

    const tx = await program.methods
      .contribute(new BN(1000000))
      .accountsPartial({
        contributor: provider.publicKey,
        fundraiser,
        contributorAccount: contributor,
        contributorAta: contributorATA,
        vault,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc()
      .then(confirm);

    console.log("\nContributed to fundraiser", tx);
    console.log("Your transaction signature", tx);
    console.log("Vault balance", (await provider.connection.getTokenAccountBalance(vault)).value.amount);

    const contributorAccount = await program.account.contributor.fetch(contributor);
    console.log("Contributor balance", contributorAccount.amount.toString());
  });

  it("Contribute to Fundraiser - Robustness Test", async () => {
    try {
      const vault = getAssociatedTokenAddressSync(mint, fundraiser, true);

      const tx = await program.methods
        .contribute(new BN(2000000))
        .accountsPartial({
          contributor: provider.publicKey,
          fundraiser,
          contributorAccount: contributor,
          contributorAta: contributorATA,
          vault,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc()
        .then(confirm);

      console.log("\nContributed to fundraiser", tx);
      console.log("Your transaction signature", tx);
      console.log("Vault balance", (await provider.connection.getTokenAccountBalance(vault)).value.amount);
    } catch (error) {
      console.log("\nError contributing to fundraiser");
      console.log(error.msg);
    }
  });

  it("Check contributions - Robustness Test", async () => {
    try {
      const vault = getAssociatedTokenAddressSync(mint, fundraiser, true);

      const tx = await program.methods
        .checkContributions()
        .accountsPartial({
          maker: maker.publicKey,
          mintToRaise: mint,
          fundraiser,
          makerAta: makerATA,
          vault,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([maker])
        .rpc()
        .then(confirm);

      console.log("\nChecked contributions");
      console.log("Your transaction signature", tx);
      console.log("Vault balance", (await provider.connection.getTokenAccountBalance(vault)).value.amount);
    } catch (error) {
      console.log("\nError checking contributions");
      console.log(error.msg);
    }
  });

  it("Refund is rejected while the campaign is still open", async () => {
    // The campaign was created with a 5-day duration and has only just started,
    // so a refund must be rejected until the campaign has ended. (A successful
    // refund requires advancing the validator clock past `duration`, e.g. with
    // bankrun's `setClock`.)
    const vault = getAssociatedTokenAddressSync(mint, fundraiser, true);

    let rejected = false;
    try {
      await program.methods
        .refund()
        .accountsPartial({
          contributor: provider.publicKey,
          maker: maker.publicKey,
          mintToRaise: mint,
          fundraiser,
          contributorAccount: contributor,
          contributorAta: contributorATA,
          vault,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc()
        .then(confirm);
    } catch (error) {
      rejected = true;
      assert.ok(String(error).includes("FundraiserNotEnded"), `expected a FundraiserNotEnded error, got: ${error}`);
    }

    assert.ok(rejected, "refund should be rejected while the campaign is still open");
  });

  it("Refunds the contributor after the campaign ends", async () => {
    const vault = getAssociatedTokenAddressSync(mint, fundraiser, true);

    // Advance the clock past the 5-day campaign window so refunds are allowed.
    await setElapsedDays(6);

    const before = BigInt((await provider.connection.getTokenAccountBalance(contributorATA)).value.amount);

    const tx = await program.methods
      .refund()
      .accountsPartial({
        contributor: provider.publicKey,
        maker: maker.publicKey,
        mintToRaise: mint,
        fundraiser,
        contributorAccount: contributor,
        contributorAta: contributorATA,
        vault,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc()
      .then(confirm);

    console.log("\nRefunded contributions", tx);

    // The 2_000_000 contributed is returned to the contributor.
    const after = BigInt((await provider.connection.getTokenAccountBalance(contributorATA)).value.amount);
    assert.equal(after - before, BigInt(2_000_000), "contributor should be refunded their contribution");

    // The vault is emptied and the contributor account is closed.
    assert.equal(
      (await provider.connection.getTokenAccountBalance(vault)).value.amount,
      "0",
      "vault should be empty after the refund",
    );
    let closed = false;
    try {
      await program.account.contributor.fetch(contributor);
    } catch {
      closed = true;
    }
    assert.ok(closed, "contributor account should be closed after the refund");
  });
});
