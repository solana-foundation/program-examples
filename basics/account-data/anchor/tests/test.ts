import * as anchor from '@anchor-lang/core';
import { Keypair } from '@solana/web3.js';
import type { AccountDataAnchorProgram } from '../target/types/account_data_anchor_program.ts';

describe('Account Data!', () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    const payer = provider.wallet as anchor.Wallet;
    const program = anchor.workspace.AccountDataAnchorProgram as anchor.Program<AccountDataAnchorProgram>;

    // Generate a new keypair for the addressInfo account
    const addressInfoAccount = new Keypair();

    it('Create the address info account', async () => {
        console.log(`Payer Address      : ${payer.publicKey}`);
        console.log(`Address Info Acct  : ${addressInfoAccount.publicKey}`);

        // Instruction Ix data
        const addressInfo = {
            name: 'Joe C',
            houseNumber: 136,
            street: 'Mile High Dr.',
            city: 'Solana Beach',
        };

        await program.methods
            .createAddressInfo(addressInfo.name, addressInfo.houseNumber, addressInfo.street, addressInfo.city)
            .accounts({
                addressInfo: addressInfoAccount.publicKey,
                payer: payer.publicKey,
            })
            .signers([addressInfoAccount])
            .rpc();
    });

    it("Read the new account's data", async () => {
        const addressInfo = await program.account.addressInfo.fetch(addressInfoAccount.publicKey);
        console.log(`Name     : ${addressInfo.name}`);
        console.log(`House Num: ${addressInfo.houseNumber}`);
        console.log(`Street   : ${addressInfo.street}`);
        console.log(`City     : ${addressInfo.city}`);
    });
});
