import * as anchor from '@anchor-lang/core';
import { PublicKey } from '@solana/web3.js';
import { LiteSVMProvider } from 'anchor-litesvm';
import BN from 'bn.js';
import { LiteSVM } from 'litesvm';
import IDL from '../target/idl/anchor.json' with { type: 'json' };
import type { Anchor } from '../target/types/anchor.ts';

const PROGRAM_ID = new PublicKey(IDL.address);

describe('anchor', () => {
    const client = new LiteSVM();
    client.addProgramFromFile(PROGRAM_ID, 'target/deploy/anchor.so');
    const provider = new LiteSVMProvider(client);
    anchor.setProvider(provider);
    const program = new anchor.Program<Anchor>(IDL, provider);
    const TOKEN_2022_PROGRAM_ID = new anchor.web3.PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
    const wallet = provider.wallet as anchor.Wallet;
    const ATA_PROGRAM_ID = new anchor.web3.PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

    const tokenName = 'TestToken';
    const [mint] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from('token-2022-token'), wallet.publicKey.toBytes(), Buffer.from(tokenName)],
        program.programId,
    );
    const [payerATA] = anchor.web3.PublicKey.findProgramAddressSync(
        [wallet.publicKey.toBytes(), TOKEN_2022_PROGRAM_ID.toBytes(), mint.toBytes()],
        ATA_PROGRAM_ID,
    );

    const receiver = anchor.web3.Keypair.generate();

    const [receiverATA] = anchor.web3.PublicKey.findProgramAddressSync(
        [receiver.publicKey.toBytes(), TOKEN_2022_PROGRAM_ID.toBytes(), mint.toBytes()],
        ATA_PROGRAM_ID,
    );

    it('Create Token-2022 Token', async () => {
        const tx = new anchor.web3.Transaction();

        const ix = await program.methods
            .createToken(tokenName)
            .accountsPartial({
                signer: wallet.publicKey,
                tokenProgram: TOKEN_2022_PROGRAM_ID,
            })
            .instruction();

        tx.add(ix);
        const sig = await provider.sendAndConfirm(tx);
        console.log('Your transaction signature', sig);
    });

    it('Initialize payer ATA', async () => {
        const tx = new anchor.web3.Transaction();

        const ix = await program.methods
            .createAssociatedTokenAccount()
            .accountsPartial({
                tokenAccount: payerATA,
                mint: mint,
                signer: wallet.publicKey,
                tokenProgram: TOKEN_2022_PROGRAM_ID,
            })
            .instruction();

        tx.add(ix);
        const sig = await provider.sendAndConfirm(tx);
        console.log('Your transaction signature', sig);
    });

    /*
  // This instruction is included only as a reference, but is not required to run this test, because we are using "init" in the program's transfer instruction. The create_associated_token_account instruction on the program is provided as a reference as well.
  it("Initialize receiver ATA", async () => {
    const tx = new anchor.web3.Transaction();
    const ix = await program.methods
      .createAssociatedTokenAccount()
      .accountsPartial({
        tokenAccount: receiverATA,
        mint: mint,
        signer: receiver.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ATA_PROGRAM_ID,
      })
      .signers([receiver])
      .instruction();
    tx.add(ix);
    const sig = await anchor.web3.sendAndConfirmTransaction(
      program.provider.connection,
      tx,
      [receiver]
    );
    console.log("Your transaction signature", sig);
  });
*/

    it('Mint Token to payer', async () => {
        const tx = new anchor.web3.Transaction();

        const ix = await program.methods
            .mintToken(new BN(200000000))
            .accountsPartial({
                mint: mint,
                signer: wallet.publicKey,
                receiver: payerATA,
                tokenProgram: TOKEN_2022_PROGRAM_ID,
            })
            .instruction();

        tx.add(ix);
        const sig = await provider.sendAndConfirm(tx);
        console.log('Your transaction signature', sig);
    });

    // Using init in the transfer instruction, as init if needed is bot working with Token 2022 yet.
    it('Transfer Token', async () => {
        const tx = new anchor.web3.Transaction();

        const ix = await program.methods
            .transferToken(new BN(100))
            .accountsPartial({
                mint: mint,
                signer: wallet.publicKey,
                from: payerATA,
                to: receiver.publicKey,
                tokenProgram: TOKEN_2022_PROGRAM_ID,
                toAta: receiverATA,
            })
            .instruction();

        tx.add(ix);
        const sig = await provider.sendAndConfirm(tx);
        console.log('Your transaction signature', sig);
    });
});
