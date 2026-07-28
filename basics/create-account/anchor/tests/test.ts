import * as anchor from '@anchor-lang/core';
import { Keypair } from '@solana/web3.js';
import { assert } from 'chai';
import Idl from '../target/idl/create_system_account.json' with { type: 'json' };
import type { CreateSystemAccount } from '../target/types/create_system_account.ts';

describe('Anchor: Create a system account', () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    const wallet = provider.wallet as anchor.Wallet;
    const connection = provider.connection;
    const program = anchor.workspace.CreateSystemAccount as anchor.Program<CreateSystemAccount>;

    it('Create the account', async () => {
        // Generate a new keypair for the new account
        const newKeypair = new Keypair();

        const addressData: anchor.IdlTypes<CreateSystemAccount>['addressData'] = {
            name: 'Marcus',
            address: '123 Main St. San Francisco, CA',
        };

        // Serialize the data so we can check the account size against it
        const addressDataBuffer = new anchor.BorshCoder(Idl as anchor.Idl).types.encode('AddressData', addressData);

        await program.methods
            .createSystemAccount(addressData)
            .accounts({
                payer: wallet.publicKey,
                newAccount: newKeypair.publicKey,
            })
            .signers([newKeypair])
            .rpc();

        // Minimum balance for rent exemption for the account's size
        const lamports = await connection.getMinimumBalanceForRentExemption(addressDataBuffer.length);

        // Check that the account was created with the right size and rent
        const accountInfo = await connection.getAccountInfo(newKeypair.publicKey);
        assert.equal(accountInfo.data.length, addressDataBuffer.length);
        assert(accountInfo.lamports === lamports);
    });
});
