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
import {
    borshSerialize,
    CreateTokenArgsSchema,
    InitArgsSchema,
    MintToArgsSchema,
    NftMinterInstruction,
} from './instructions';

function createKeypairFromFile(path: string): Keypair {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(require('node:fs').readFileSync(path, 'utf-8'))));
}

describe('NFT Minter', async () => {
    // const connection = new Connection(`http://localhost:8899`, 'confirmed');
    const connection = new Connection('https://api.devnet.solana.com/', 'confirmed');
    const payer = createKeypairFromFile(`${require('node:os').homedir()}/.config/solana/id.json`);
    const program = createKeypairFromFile('./program/target/deploy/program-keypair.json');

    const mintAuthorityPublicKey = PublicKey.findProgramAddressSync(
        [Buffer.from('mint_authority')],
        program.publicKey,
    )[0];

    const mintKeypair: Keypair = Keypair.generate();

    it('Init Mint Authority PDA', async () => {
        const instructionData = borshSerialize(InitArgsSchema, {
            instruction: NftMinterInstruction.Init,
        });

        const ix = new TransactionInstruction({
            keys: [
                { pubkey: mintAuthorityPublicKey, isSigner: false, isWritable: true },
                { pubkey: payer.publicKey, isSigner: false, isWritable: true },
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            ],
            programId: program.publicKey,
            data: instructionData,
        });

        const sx = await sendAndConfirmTransaction(connection, new Transaction().add(ix), [payer], {
            skipPreflight: true,
        });

        console.log('Success!');
        console.log(`   Mint Address: ${mintKeypair.publicKey}`);
        console.log(`   Tx Signature: ${sx}`);
    });

    it('Create an NFT!', async () => {
        const metadataAddress = PublicKey.findProgramAddressSync(
            [Buffer.from('metadata'), TOKEN_METADATA_PROGRAM_ID.toBuffer(), mintKeypair.publicKey.toBuffer()],
            TOKEN_METADATA_PROGRAM_ID,
        )[0];

        const instructionData = borshSerialize(CreateTokenArgsSchema, {
            instruction: NftMinterInstruction.Create,
            nft_title: 'Homer NFT',
            nft_symbol: 'HOMR',
            nft_uri:
                'https://raw.githubusercontent.com/solana-developers/program-examples/new-examples/tokens/tokens/.assets/nft.json',
        });

        const ix = new TransactionInstruction({
            keys: [
                { pubkey: mintKeypair.publicKey, isSigner: true, isWritable: true }, // Mint account
                { pubkey: mintAuthorityPublicKey, isSigner: false, isWritable: true }, // Mint authority account
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

        const sx = await sendAndConfirmTransaction(connection, new Transaction().add(ix), [payer, mintKeypair], {
            skipPreflight: true,
        });

        console.log('Success!');
        console.log(`   Mint Address: ${mintKeypair.publicKey}`);
        console.log(`   Tx Signature: ${sx}`);
    });

    it('Mint the NFT to your wallet!', async () => {
        const metadataAddress = PublicKey.findProgramAddressSync(
            [Buffer.from('metadata'), TOKEN_METADATA_PROGRAM_ID.toBuffer(), mintKeypair.publicKey.toBuffer()],
            TOKEN_METADATA_PROGRAM_ID,
        )[0];

        const editionAddress = PublicKey.findProgramAddressSync(
            [
                Buffer.from('metadata'),
                TOKEN_METADATA_PROGRAM_ID.toBuffer(),
                mintKeypair.publicKey.toBuffer(),
                Buffer.from('edition'),
            ],
            TOKEN_METADATA_PROGRAM_ID,
        )[0];

        const associatedTokenAccountAddress = await getAssociatedTokenAddress(mintKeypair.publicKey, payer.publicKey);

        const instructionData = borshSerialize(MintToArgsSchema, {
            instruction: NftMinterInstruction.Mint,
        });

        const ix = new TransactionInstruction({
            keys: [
                { pubkey: mintKeypair.publicKey, isSigner: false, isWritable: true }, // Mint account
                { pubkey: metadataAddress, isSigner: false, isWritable: true }, // Metadata account
                { pubkey: editionAddress, isSigner: false, isWritable: true }, // Edition account
                { pubkey: mintAuthorityPublicKey, isSigner: false, isWritable: true }, // Mint authority account
                {
                    pubkey: associatedTokenAccountAddress,
                    isSigner: false,
                    isWritable: true,
                }, // ATA
                { pubkey: payer.publicKey, isSigner: true, isWritable: true }, // Payer
                { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false }, // Rent account
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // System program
                { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // Token program
                {
                    pubkey: ASSOCIATED_TOKEN_PROGRAM_ID,
                    isSigner: false,
                    isWritable: false,
                }, // Associated token program
                {
                    pubkey: TOKEN_METADATA_PROGRAM_ID,
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
