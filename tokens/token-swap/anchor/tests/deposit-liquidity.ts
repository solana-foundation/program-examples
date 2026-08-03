import type { Program } from '@anchor-lang/core';
import * as anchor from '@anchor-lang/core';
import { expect } from 'chai';
import type { SwapExample } from '../target/types/swap_example';
import { createValues, mintingTokens, type TestValues } from './utils';

describe('Deposit liquidity', () => {
    const provider = anchor.AnchorProvider.env();
    const connection = provider.connection;
    anchor.setProvider(provider);

    const program = anchor.workspace.SwapExample as Program<SwapExample>;

    let values: TestValues;

    beforeEach(async () => {
        values = createValues();

        await program.methods
            .createAmm(values.id, values.fee)
            .accountsPartial({ amm: values.ammKey, admin: values.admin.publicKey })
            .rpc();

        await mintingTokens({
            connection,
            creator: values.admin,
            mintAKeypair: values.mintAKeypair,
            mintBKeypair: values.mintBKeypair,
        });

        await program.methods
            .createPool()
            .accountsPartial({
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
    });

    it('Deposit equal amounts', async () => {
        await program.methods
            .depositLiquidity(values.depositAmountA, values.depositAmountA)
            .accountsPartial({
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

        const depositTokenAccountLiquditiy = await connection.getTokenAccountBalance(values.liquidityAccount);
        expect(depositTokenAccountLiquditiy.value.amount).to.equal(
            values.depositAmountA.sub(values.minimumLiquidity).toString(),
        );
        const depositTokenAccountA = await connection.getTokenAccountBalance(values.holderAccountA);
        expect(depositTokenAccountA.value.amount).to.equal(values.defaultSupply.sub(values.depositAmountA).toString());
        const depositTokenAccountB = await connection.getTokenAccountBalance(values.holderAccountB);
        expect(depositTokenAccountB.value.amount).to.equal(values.defaultSupply.sub(values.depositAmountA).toString());
    });

    it('Deposit with existing liquidity (same ratio)', async () => {
        // 1. Initial Deposit
        await program.methods
            .depositLiquidity(values.depositAmountA, values.depositAmountA)
            .accountsPartial({
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

        // 2. Second Deposit
        const secondDepositAmount = new anchor.BN(100000);
        await program.methods
            .depositLiquidity(secondDepositAmount, secondDepositAmount)
            .accountsPartial({
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

        const poolAccountA = await connection.getTokenAccountBalance(values.poolAccountA);
        expect(poolAccountA.value.amount).to.equal(values.depositAmountA.add(secondDepositAmount).toString());
    });

    it('Deposit with different ratio', async () => {
        // 1. Initial Deposit with 1:5 ratio
        // Pool A: 1,000,000
        // Pool B: 5,000,000
        const initialAmountA = new anchor.BN(1_000_000);
        const initialAmountB = new anchor.BN(5_000_000);

        await program.methods
            .depositLiquidity(initialAmountA, initialAmountB)
            .accountsPartial({
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

        // 2. Second Deposit with mismatched input
        // Input A: 500,000
        // Input B: 500,000
        // Logic:
        // - 500k A requires 2.5M B. (User only provided 500k B).
        // - 500k B requires 100k A. (User provided 500k A).
        // Result: Deposit 100k A and 500k B.
        const secondDepositA = new anchor.BN(500000);
        const secondDepositBInput = new anchor.BN(500000);

        await program.methods
            .depositLiquidity(secondDepositA, secondDepositBInput)
            .accountsPartial({
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

        // 3. Verify Balances
        const poolAccountA = await connection.getTokenAccountBalance(values.poolAccountA);
        const poolAccountB = await connection.getTokenAccountBalance(values.poolAccountB);

        // Total A: 1,000,000 + 100,000 = 1,100,000
        // We expect 100,000 A to be deposited.
        const expectedAdditionalA = secondDepositBInput.mul(initialAmountA).div(initialAmountB); // 500k * (1M/5M) = 100k
        expect(poolAccountA.value.amount).to.equal(initialAmountA.add(expectedAdditionalA).toString());

        // Total B: 5,000,000 + 500,000 = 5,500,000
        expect(poolAccountB.value.amount).to.equal(initialAmountB.add(secondDepositBInput).toString());
    });
});
