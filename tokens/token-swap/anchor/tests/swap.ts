import type { Program } from '@anchor-lang/core';
import * as anchor from '@anchor-lang/core';
import { expect } from 'chai';
import type { SwapExample } from '../target/types/swap_example';
import { createValues, mintingTokens, type TestValues } from './utils';

describe('Swap', () => {
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

        await program.methods
            .depositLiquidity(values.depositAmountA, values.depositAmountB)
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
    });

    it('Swap from A to B', async () => {
        const input = new anchor.BN(10 ** 6);
        await program.methods
            .swapExactTokensForTokens(true, input, new anchor.BN(100))
            .accountsPartial({
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

    it('Swap from B to A', async () => {
        const input = new anchor.BN(3 * 10 ** 6);

        // Mirror the on-chain constant-product formula exactly, so this
        // asserts the precise output amount rather than a broad range.
        const feeAmount = input.mul(new anchor.BN(values.fee)).div(new anchor.BN(10000));
        const taxedInput = input.sub(feeAmount);
        const expectedOutput = taxedInput.mul(values.depositAmountA).div(values.depositAmountB.add(taxedInput));

        await program.methods
            .swapExactTokensForTokens(false, input, new anchor.BN(100))
            .accountsPartial({
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
        expect(traderTokenAccountB.value.amount).to.equal(
            values.defaultSupply.sub(values.depositAmountB).sub(input).toString(),
        );
        expect(traderTokenAccountA.value.amount).to.equal(
            values.defaultSupply.sub(values.depositAmountA).add(expectedOutput).toString(),
        );
    });
});
