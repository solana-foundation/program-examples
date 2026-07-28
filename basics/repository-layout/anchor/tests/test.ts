import * as anchor from '@anchor-lang/core';
import type { Carnival } from '../target/types/carnival.ts';

describe('Carnival', () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    const wallet = provider.wallet as anchor.Wallet;
    const program = anchor.workspace.Carnival as anchor.Program<Carnival>;

    async function sendCarnivalInstructions(instructionsList: anchor.web3.TransactionInstruction[]) {
        const tx = new anchor.web3.Transaction();
        for (const ix of instructionsList) {
            tx.add(ix);
        }
        await anchor.web3.sendAndConfirmTransaction(provider.connection, tx, [wallet.payer]);
    }

    it('Go on some rides!', async () => {
        await sendCarnivalInstructions([
            await program.methods.goOnRide('Jimmy', 36, 15, 'Scrambler').instruction(),
            await program.methods.goOnRide('Mary', 52, 1, 'Ferris Wheel').instruction(),
            await program.methods.goOnRide('Alice', 56, 15, 'Scrambler').instruction(),
            await program.methods.goOnRide('Bob', 49, 6, 'Tilt-a-Whirl').instruction(),
        ]);
    });

    it('Play some games!', async () => {
        await sendCarnivalInstructions([
            await program.methods.playGame('Jimmy', 15, 'I Got It!').instruction(),
            await program.methods.playGame('Mary', 1, 'Ring Toss').instruction(),
            await program.methods.playGame('Alice', 15, 'Ladder Climb').instruction(),
            await program.methods.playGame('Bob', 6, 'Ring Toss').instruction(),
        ]);
    });

    it('Eat some food!', async () => {
        await sendCarnivalInstructions([
            await program.methods.eatFood('Jimmy', 15, 'Taco Shack').instruction(),
            await program.methods.eatFood('Mary', 1, "Larry's Pizza").instruction(),
            await program.methods.eatFood('Alice', 15, "Dough Boy's").instruction(),
            await program.methods.eatFood('Bob', 6, "Dough Boy's").instruction(),
        ]);
    });
});
