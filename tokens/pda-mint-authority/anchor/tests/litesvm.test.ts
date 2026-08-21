import * as anchor from '@anchor-lang/core';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { assert } from 'chai';
import { LiteSVMProvider } from 'anchor-litesvm';
import { LiteSVM } from 'litesvm';
import IDL from '../target/idl/token_minter.json';
import type { TokenMinter } from '../target/types/token_minter';

const expectAnchorError = async (promise: Promise<unknown>, code: string) => {
    let caught: any;
    try {
        await promise;
    } catch (error) {
        caught = error;
    }
    assert.isDefined(caught, `expected the transaction to fail with ${code}`);
    assert.strictEqual(caught?.error?.errorCode?.code, code, `expected ${code}, got: ${caught}`);
};

const PROGRAM_ID = new PublicKey(IDL.address);
const METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

describe('NFT Minter', () => {
    const client = new LiteSVM();
    client.addProgramFromFile(PROGRAM_ID, 'target/deploy/token_minter.so');
    client.addProgramFromFile(METADATA_PROGRAM_ID, 'tests/fixtures/token_metadata.so');
    const provider = new LiteSVMProvider(client);
    anchor.setProvider(provider);
    const payer = provider.wallet as anchor.Wallet;
    const program = new anchor.Program<TokenMinter>(IDL, provider);

    // Derive the PDA to use as mint account address.
    // This same PDA is also used as the mint authority.
    const [mintPDA] = PublicKey.findProgramAddressSync([Buffer.from('mint')], program.programId);

    const metadata = {
        name: 'Solana Gold',
        symbol: 'GOLDSOL',
        uri: 'https://raw.githubusercontent.com/solana-developers/program-examples/new-examples/tokens/tokens/.assets/spl-token.json',
    };

    it('Create a token!', async () => {
        const transactionSignature = await program.methods
            .createToken(metadata.name, metadata.symbol, metadata.uri)
            .accountsPartial({
                payer: payer.publicKey,
            })
            .rpc();

        console.log('Success!');
        console.log(`   Mint Address: ${mintPDA}`);
        console.log(`   Transaction Signature: ${transactionSignature}`);
    });

    it('Mint 1 Token!', async () => {
        // Derive the associated token address account for the mint and payer.
        const associatedTokenAccountAddress = getAssociatedTokenAddressSync(mintPDA, payer.publicKey);

        // Amount of tokens to mint.
        const amount = new anchor.BN(100);

        const transactionSignature = await program.methods
            .mintToken(amount)
            .accountsPartial({
                payer: payer.publicKey,
                associatedTokenAccount: associatedTokenAccountAddress,
            })
            .rpc();

        console.log('Success!');
        console.log(`   Associated Token Account Address: ${associatedTokenAccountAddress}`);
        console.log(`   Transaction Signature: ${transactionSignature}`);
    });

    it('rejects mint_token from a wallet that did not create the token', async () => {
        const outsider = Keypair.generate();
        client.airdrop(outsider.publicKey, BigInt(LAMPORTS_PER_SOL));
        const outsiderAta = getAssociatedTokenAddressSync(mintPDA, outsider.publicKey);

        await expectAnchorError(
            program.methods
                .mintToken(new anchor.BN(100))
                .accountsPartial({
                    payer: outsider.publicKey,
                    associatedTokenAccount: outsiderAta,
                })
                .signers([outsider])
                .rpc(),
            'Unauthorized',
        );
    });
});
