import * as anchor from '@anchor-lang/core';
import type { HelloSolana } from '../target/types/hello_solana.ts';

describe('Anchor: hello-solana', () => {
    // Configure the Anchor provider & load the program IDL
    // The IDL gives you a typescript module
    //
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    const program = anchor.workspace.HelloSolana as anchor.Program<HelloSolana>;

    it('Say hello!', async () => {
        // Just run Anchor's IDL method to build a transaction!
        //
        await program.methods.hello().accounts({}).rpc();
    });
});
