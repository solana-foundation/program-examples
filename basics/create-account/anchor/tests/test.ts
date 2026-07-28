import * as anchor from '@anchor-lang/core';
import { Keypair } from '@solana/web3.js';
import { assert } from 'chai';
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

        await program.methods
            .createSystemAccount()
            .accounts({
                payer: wallet.publicKey,
                newAccount: newKeypair.publicKey,
            })
            .signers([newKeypair])
            .rpc();

        // Minimum balance for rent exemption for new account
        const lamports = await connection.getMinimumBalanceForRentExemption(0);

        // Check that the account was created
        const accountInfo = await connection.getAccountInfo(newKeypair.publicKey);
        assert(accountInfo.lamports === lamports);
    });
});
