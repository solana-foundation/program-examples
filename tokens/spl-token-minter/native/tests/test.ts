import { Buffer } from 'node:buffer';
import { PROGRAM_ID as TOKEN_METADATA_PROGRAM_ID } from '@metaplex-foundation/mpl-token-metadata';
import { ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddress, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import {
    Connection,
    Keypair,
    PublicKey,
    SYSVAR_RENT_PUBKEY,
    SystemProgram,
    sendAndConfirmTransaction,
    Transaction,
    TransactionInstruction,
} from '@solana/web3.js';
import { BN } from 'bn.js';
import { borshSerialize, CreateTokenArgsSchema, MintToArgsSchema, SplMinterInstruction } from './instructions';

function createKeypairFromFile(path: string): Keypair {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(require('node:fs').readFileSync(path, 'utf-8'))));
}

describe('SPL Token Minter', async () => {
    // const connection = new Connection(`http://localhost:8899`, 'confirmed');
    const connection = new Connection('https://api.devnet.solana.com/', 'confirmed');
    const payer = createKeypairFromFile(`${require('node:os').homedir()}/.config/solana/id.json`);
    const program = createKeypairFromFile('./program/target/deploy/program-keypair.json');

    const mintKeypair: Keypair = Keypair.generate();

    it('Create an SPL Token!', async () => {
        const metadataAddress = PublicKey.findProgramAddressSync(
            [Buffer.from('metadata'), TOKEN_METADATA_PROGRAM_ID.toBuffer(), mintKeypair.publicKey.toBuffer()],
            TOKEN_METADATA_PROGRAM_ID,
        )[0];

        const instructionData = borshSerialize(CreateTokenArgsSchema, {
            instruction: SplMinterInstruction.Create,
            token_title: 'Solana Gold',
            token_symbol: 'GOLDSOL',
            token_uri:
                'https://raw.githubusercontent.com/solana-developers/program-examples/new-examples/tokens/tokens/.assets/spl-token.json',
        });

        const ix = new TransactionInstruction({
            keys: [
                { pubkey: mintKeypair.publicKey, isSigner: true, isWritable: true }, // Mint account
                { pubkey: payer.publicKey, isSigner: false, isWritable: true }, // Mint authority account
                { pubkey: metadataAddress, isSigner: false, isWritable: true }, // Metadata account
                { pubkey: payer.publicKey, isSigner: true, isWritable: true }, // Payer
                { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false }, // Rent account
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // System program
                { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // Token program
                {
                    pubkey: TOKEN_METADATA_PROGRAM_ID,
                    isSigner: false,
                    isWritable: false,
                }, // Token metadata program
            ],
            programId: program.publicKey,
            data: instructionData,
        });

        const sx = await sendAndConfirmTransaction(connection, new Transaction().add(ix), [payer, mintKeypair]);

        console.log('Success!');
        console.log(`   Mint Address: ${mintKeypair.publicKey}`);
        console.log(`   Tx Signature: ${sx}`);
    });

    it('Mint some tokens to your wallet!', async () => {
        const associatedTokenAccountAddress = await getAssociatedTokenAddress(mintKeypair.publicKey, payer.publicKey);

        const instructionData = borshSerialize(MintToArgsSchema, {
            instruction: SplMinterInstruction.Mint,
            quantity: new BN(150),
        });

        const ix = new TransactionInstruction({
            keys: [
                { pubkey: mintKeypair.publicKey, isSigner: false, isWritable: true }, // Mint account
                { pubkey: payer.publicKey, isSigner: false, isWritable: true }, // Mint authority account
                {
                    pubkey: associatedTokenAccountAddress,
                    isSigner: false,
                    isWritable: true,
                }, // ATA
                { pubkey: payer.publicKey, isSigner: true, isWritable: true }, // Payer
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: true }, // System program
                { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // Token program
                {
                    pubkey: ASSOCIATED_TOKEN_PROGRAM_ID,
                    isSigner: false,
                    isWritable: false,
                }, // Token metadata program
            ],
            programId: program.publicKey,
            data: instructionData,
        });

        const sx = await sendAndConfirmTransaction(connection, new Transaction().add(ix), [payer]);

        console.log('Success!');
        console.log(`   ATA Address: ${associatedTokenAccountAddress}`);
        console.log(`   Tx Signature: ${sx}`);
    });
});
