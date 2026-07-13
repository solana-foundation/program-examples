import type { Program } from "@anchor-lang/core";
import * as anchor from "@anchor-lang/core";
import { BN } from "bn.js";
import { expect } from "chai";
import type { SwapExample } from "../target/types/swap_example";
import { createValues, mintingTokens, type TestValues } from "./utils";

describe("Swap", () => {
  const provider = anchor.AnchorProvider.env();
  const connection = provider.connection;
  anchor.setProvider(provider);

  const program = anchor.workspace.SwapExample as Program<SwapExample>;

  let values: TestValues;

  beforeEach(async () => {
    values = createValues();

    await program.methods
      .createAmm(values.id, values.fee)
      .accounts({ amm: values.ammKey, admin: values.admin.publicKey })
      .rpc();

    await mintingTokens({
      connection,
      creator: values.admin,
      mintAKeypair: values.mintAKeypair,
      mintBKeypair: values.mintBKeypair,
    });

    await program.methods
      .createPool()
      .accounts({
        amm: values.ammKey,
        pool: values.poolKey,
        poolAuthority: values.poolAuthority,
        mintLiquidity: values.mintLiquidity,
        mintA: values.mintAKeypair.publicKey,
        mintB: values.mintBKeypair.publicKey,
        poolAccountA: values.poolAccountA,
        poolAccountB: values.poolAccountB,
      })
      .rpc();

    await program.methods
      .depositLiquidity(values.depositAmountA, values.depositAmountB)
      .accounts({
        pool: values.poolKey,
        poolAuthority: values.poolAuthority,
        depositor: values.admin.publicKey,
        mintLiquidity: values.mintLiquidity,
        mintA: values.mintAKeypair.publicKey,
        mintB: values.mintBKeypair.publicKey,
        poolAccountA: values.poolAccountA,
        poolAccountB: values.poolAccountB,
        depositorAccountLiquidity: values.liquidityAccount,
        depositorAccountA: values.holderAccountA,
        depositorAccountB: values.holderAccountB,
      })
      .signers([values.admin])
      .rpc({ skipPreflight: true });
  });

  it("Swap from A to B", async () => {
    const input = new BN(10 ** 6);
    await program.methods
      .swapExactTokensForTokens(true, input, new BN(100))
      .accounts({
        amm: values.ammKey,
        pool: values.poolKey,
        poolAuthority: values.poolAuthority,
        trader: values.admin.publicKey,
        mintA: values.mintAKeypair.publicKey,
        mintB: values.mintBKeypair.publicKey,
        poolAccountA: values.poolAccountA,
        poolAccountB: values.poolAccountB,
        traderAccountA: values.holderAccountA,
        traderAccountB: values.holderAccountB,
      })
      .signers([values.admin])
      .rpc({ skipPreflight: true });

    const traderTokenAccountA = await connection.getTokenAccountBalance(values.holderAccountA);
    const traderTokenAccountB = await connection.getTokenAccountBalance(values.holderAccountB);
    expect(traderTokenAccountA.value.amount).to.equal(
      values.defaultSupply.sub(values.depositAmountA).sub(input).toString(),
    );
    expect(Number(traderTokenAccountB.value.amount)).to.be.greaterThan(
      values.defaultSupply.sub(values.depositAmountB).toNumber(),
    );
    expect(Number(traderTokenAccountB.value.amount)).to.be.lessThan(
      values.defaultSupply.sub(values.depositAmountB).add(input).toNumber(),
    );
  });

  it("Withdraw Liquidity successfully", async () => {
    const initialLiquidity = await connection.getTokenAccountBalance(values.liquidityAccount);
    const initialA = await connection.getTokenAccountBalance(values.holderAccountA);
    const initialB = await connection.getTokenAccountBalance(values.holderAccountB);

    const withdrawAmount = new BN(initialLiquidity.value.amount).div(new BN(2));

    await program.methods
      .withdrawLiquidity(withdrawAmount)
      .accounts({
        amm: values.ammKey,
        pool: values.poolKey,
        poolAuthority: values.poolAuthority,
        depositor: values.admin.publicKey,
        mintLiquidity: values.mintLiquidity,
        mintA: values.mintAKeypair.publicKey,
        mintB: values.mintBKeypair.publicKey,
        poolAccountA: values.poolAccountA,
        poolAccountB: values.poolAccountB,
        depositorAccountLiquidity: values.liquidityAccount,
        depositorAccountA: values.holderAccountA,
        depositorAccountB: values.holderAccountB,
      })
      .signers([values.admin])
      .rpc();

    const postLiquidity = await connection.getTokenAccountBalance(values.liquidityAccount);
    const postA = await connection.getTokenAccountBalance(values.holderAccountA);
    const postB = await connection.getTokenAccountBalance(values.holderAccountB);

    expect(new BN(postLiquidity.value.amount).toString()).to.equal(
      new BN(initialLiquidity.value.amount).sub(withdrawAmount).toString()
    );

    expect(new BN(postA.value.amount).gt(new BN(initialA.value.amount))).to.be.true;
    expect(new BN(postB.value.amount).gt(new BN(initialB.value.amount))).to.be.true;
  });

  it("Should fail if slippage limit is violated (min_output_amount too high)", async () => {
    const input = new BN(10 ** 6);
    const impossibleMinOutput = input.mul(new BN(10));

    let targetError: any = null;

    try {
      await program.methods
        .swapExactTokensForTokens(true, input, impossibleMinOutput)
        .accounts({
          amm: values.ammKey,
          pool: values.poolKey,
          poolAuthority: values.poolAuthority,
          trader: values.admin.publicKey,
          mintA: values.mintAKeypair.publicKey,
          mintB: values.mintBKeypair.publicKey,
          poolAccountA: values.poolAccountA,
          poolAccountB: values.poolAccountB,
          traderAccountA: values.holderAccountA,
          traderAccountB: values.holderAccountB,
        })
        .signers([values.admin])
        .rpc();
    } catch (err: any) {
      targetError = err;
    }

    if (!targetError) {
      expect.fail("The transaction should have failed due to high slippage bounds, but it succeeded.");
    }
    const errorMessage = targetError.toString();
    expect(errorMessage).to.include("OutputTooSmall");
  });
});
