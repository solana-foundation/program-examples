import type { Program } from '@anchor-lang/core';
import * as anchor from '@anchor-lang/core';
import { expect } from 'chai';
import type { SwapExample } from '../target/types/swap_example';
import { createValues, expectRevert, type TestValues } from './utils';

describe('Create AMM', () => {
    const provider = anchor.AnchorProvider.env();
    const _connection = provider.connection;
    anchor.setProvider(provider);

    const program = anchor.workspace.SwapExample as Program<SwapExample>;

    let values: TestValues;

    beforeEach(() => {
        values = createValues();
    });

    it('Creation', async () => {
        await program.methods
            .createAmm(values.id, values.fee)
            .accountsPartial({ amm: values.ammKey, admin: values.admin.publicKey })
            .rpc();

        const ammAccount = await program.account.amm.fetch(values.ammKey);
        expect(ammAccount.id.toString()).to.equal(values.id.toString());
        expect(ammAccount.admin.toString()).to.equal(values.admin.publicKey.toString());
        expect(ammAccount.fee.toString()).to.equal(values.fee.toString());
    });

    it('Invalid fee', async () => {
        values.fee = 10000;

        await expectRevert(
            program.methods
                .createAmm(values.id, values.fee)
                .accountsPartial({ amm: values.ammKey, admin: values.admin.publicKey })
                .rpc(),
        );
    });
});
