import type { Program } from '@anchor-lang/core';
import * as anchor from '@anchor-lang/core';
import { assert } from 'chai';
import type { Hand } from '../target/types/hand.ts';
import type { Lever } from '../target/types/lever.ts';

describe('Anchor: CPI', () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const hand = anchor.workspace.Hand as Program<Hand>;
    const lever = anchor.workspace.Lever as Program<Lever>;

    // Generate a new keypair for the power account
    const powerAccount = new anchor.web3.Keypair();

    it('Initialize the lever!', async () => {
        await lever.methods
            .initialize()
            .accounts({
                power: powerAccount.publicKey,
                user: provider.wallet.publicKey,
            })
            .signers([powerAccount])
            .rpc();

        /**
         * Fetch account
         * Check its required lamports
         * Check it powerstatus
         * */
        const minLamports = await provider.connection.getMinimumBalanceForRentExemption(8 + 8);
        const powerStatus = await lever.account.powerStatus.fetch(powerAccount.publicKey);
        const powerAccountInfo = await provider.connection.getAccountInfo(powerAccount.publicKey);

        assert(Number(minLamports) === powerAccountInfo.lamports);
        assert(powerStatus.isOn === false);
    });

    it('Pull the lever!', async () => {
        await hand.methods
            .pullLever('Jacob')
            .accounts({
                power: powerAccount.publicKey,
            })
            .rpc();

        /**
         * Fetch account
         * Check its powerstatus = true
         * */
        const powerStatus = await lever.account.powerStatus.fetch(powerAccount.publicKey);

        assert(powerStatus.isOn === true);
    });

    it('Pull it again!', async () => {
        await hand.methods
            .pullLever('sol-warrior')
            .accounts({
                power: powerAccount.publicKey,
            })
            .rpc();

        /**
         * Fetch account
         * Check its powerstatus = false
         * */
        const powerStatus = await lever.account.powerStatus.fetch(powerAccount.publicKey);

        assert(powerStatus.isOn === false);
    });
});
