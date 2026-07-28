import type { Program } from '@anchor-lang/core';
import * as anchor from '@anchor-lang/core';
import { expect } from 'chai';
import type { SwapExample } from '../target/types/swap_example';
import { createValues, mintingTokens, type TestValues } from './utils';

describe('Withdraw liquidity', () => {
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
    });

    it('Withdraw everything', async () => {
        await program.methods
            .withdrawLiquidity(values.depositAmountA.sub(values.minimumLiquidity))
            .accountsPartial({
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
            .rpc({ skipPreflight: true });

        const liquidityTokenAccount = await connection.getTokenAccountBalance(values.liquidityAccount);
        const depositTokenAccountA = await connection.getTokenAccountBalance(values.holderAccountA);
        const depositTokenAccountB = await connection.getTokenAccountBalance(values.holderAccountB);
        expect(liquidityTokenAccount.value.amount).to.equal('0');
        expect(Number(depositTokenAccountA.value.amount)).to.be.lessThan(values.defaultSupply.toNumber());
        expect(Number(depositTokenAccountA.value.amount)).to.be.greaterThan(
            values.defaultSupply.sub(values.depositAmountA).toNumber(),
        );
        expect(Number(depositTokenAccountB.value.amount)).to.be.lessThan(values.defaultSupply.toNumber());
        expect(Number(depositTokenAccountB.value.amount)).to.be.greaterThan(
            values.defaultSupply.sub(values.depositAmountA).toNumber(),
        );
    });
});
