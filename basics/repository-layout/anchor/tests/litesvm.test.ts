import anchor from '@anchor-lang/core';
import { Keypair, LAMPORTS_PER_SOL, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import { LiteSVM } from 'litesvm';
import Idl from '../target/idl/carnival.json' with { type: 'json' };

describe('LiteSVM: Carnival', () => {
    const svm = new LiteSVM();
    const programId = new PublicKey(Idl.address);
    const coder = new anchor.BorshCoder(Idl as anchor.Idl);
    const payer = Keypair.generate();
    svm.airdrop(payer.publicKey, BigInt(5 * LAMPORTS_PER_SOL));

    const programPath = new URL('../target/deploy/carnival.so', import.meta.url).pathname;
    svm.addProgramFromFile(programId, programPath);

    it('Go on some rides!', () => {
        const jimmyIxArgs = {
            name: 'Jimmy',
            height: 36,
            ticket_count: 15,
            ride_name: 'Scrambler',
        };
        const maryIxArgs = {
            name: 'Mary',
            height: 52,
            ticket_count: 1,
            ride_name: 'Ferris Wheel',
        };
        const bobIxArgs = {
            name: 'Alice',
            height: 56,
            ticket_count: 15,
            ride_name: 'Scrambler',
        };
        const aliceIxArgs = {
            name: 'Bob',
            height: 49,
            ticket_count: 6,
            ride_name: 'Tilt-a-Whirl',
        };

        createAndSendTx(jimmyIxArgs, 'go_on_ride');
        createAndSendTx(maryIxArgs, 'go_on_ride');
        createAndSendTx(bobIxArgs, 'go_on_ride');
        createAndSendTx(aliceIxArgs, 'go_on_ride');
    });

    it('Play some games!', () => {
        const jimmyIxArgs = {
            name: 'Jimmy',
            ticket_count: 15,
            game_name: 'I Got It!',
        };
        const maryIxArgs = {
            name: 'Mary',
            ticket_count: 1,
            game_name: 'Ring Toss',
        };
        const aliceIxArgs = {
            name: 'Alice',
            ticket_count: 15,
            game_name: 'Ladder Climb',
        };
        const bobIxArgs = {
            name: 'Bob',
            ticket_count: 6,
            game_name: 'Ring Toss',
        };

        createAndSendTx(jimmyIxArgs, 'play_game');
        createAndSendTx(maryIxArgs, 'play_game');
        createAndSendTx(aliceIxArgs, 'play_game');
        createAndSendTx(bobIxArgs, 'play_game');
    });

    it('Eat some food!', () => {
        const jimmyIxArgs = {
            name: 'Jimmy',
            ticket_count: 15,
            food_stand_name: 'Taco Shack',
        };
        const maryIxArgs = {
            name: 'Mary',
            ticket_count: 1,
            food_stand_name: "Larry's Pizza",
        };
        const aliceIxArgs = {
            name: 'Alice',
            ticket_count: 15,
            food_stand_name: "Dough Boy's",
        };
        const bobIxArgs = {
            name: 'Bob',
            ticket_count: 6,
            food_stand_name: "Dough Boy's",
        };

        createAndSendTx(jimmyIxArgs, 'eat_food');
        createAndSendTx(maryIxArgs, 'eat_food');
        createAndSendTx(aliceIxArgs, 'eat_food');
        createAndSendTx(bobIxArgs, 'eat_food');
    });

    function createAndSendTx(ixArgs: Record<string, string | number>, ixName: string) {
        const data = coder.instruction.encode(ixName, ixArgs);
        const ix = new TransactionInstruction({
            keys: [{ pubkey: payer.publicKey, isSigner: true, isWritable: true }],
            programId,
            data,
        });

        const tx = new Transaction().add(ix);
        tx.feePayer = payer.publicKey;
        tx.recentBlockhash = svm.latestBlockhash();
        tx.sign(payer);
        const _re = svm.sendTransaction(tx);
        // console.log(re.toString());
    }
});
