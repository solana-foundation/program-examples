import * as anchor from '@anchor-lang/core';
import { assert } from 'chai';
import Idl from '../target/idl/rent_example.json' with { type: 'json' };
import type { RentExample } from '../target/types/rent_example.ts';

describe('Anchor: Create a system account', () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    const wallet = provider.wallet as anchor.Wallet;
    const program = anchor.workspace.RentExample as anchor.Program<RentExample>;

    it('Create the account', async () => {
        const newKeypair = anchor.web3.Keypair.generate();

        const addressData: anchor.IdlTypes<RentExample>['addressData'] = {
            name: 'Marcus',
            address: '123 Main St. San Francisco, CA',
        };

        // We're just going to serialize our object here so we can check
        //  the size on the client side against the program logs
        //
        const addressDataBuffer = new anchor.BorshCoder(Idl as anchor.Idl).types.encode('AddressData', addressData);

        await program.methods
            .createSystemAccount(addressData)
            .accounts({
                payer: wallet.publicKey,
                newAccount: newKeypair.publicKey,
            })
            .signers([wallet.payer, newKeypair])
            .rpc();

        const newKeypairInfo = await provider.connection.getAccountInfo(newKeypair.publicKey);

        assert.equal(newKeypairInfo.data.length, addressDataBuffer.length);
    });
});
