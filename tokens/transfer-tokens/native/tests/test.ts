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
import {
    borshSerialize,
    CreateTokenArgsSchema,
    MintNftArgsSchema,
    MintSplArgsSchema,
    MyInstruction,
    TransferTokensArgsSchema,
} from './instructions';

function createKeypairFromFile(path: string): Keypair {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(require('node:fs').readFileSync(path, 'utf-8'))));
}

describe('Transferring Tokens', async () => {
    // const connection = new Connection(`http://localhost:8899`, 'confirmed');
    const connection = new Connection('https://api.devnet.solana.com/', 'confirmed');
    const payer = createKeypairFromFile(`${require('node:os').homedir()}/.config/solana/id.json`);
    const program = createKeypairFromFile('./program/target/deploy/program-keypair.json');

    const tokenMintKeypair: Keypair = Keypair.generate();
    const nftMintKeypair: Keypair = Keypair.generate();

    const recipientWallet = Keypair.generate();

    it('Create an SPL Token!', async () => {
        const metadataAddress = PublicKey.findProgramAddressSync(
            [Buffer.from('metadata'), TOKEN_METADATA_PROGRAM_ID.toBuffer(), tokenMintKeypair.publicKey.toBuffer()],
            TOKEN_METADATA_PROGRAM_ID,
        )[0];

        const instructionData = borshSerialize(CreateTokenArgsSchema, {
            instruction: MyInstruction.Create,
            token_title: 'Solana Gold',
            token_symbol: 'GOLDSOL',
            token_uri:
                'https://raw.githubusercontent.com/solana-developers/program-examples/new-examples/tokens/tokens/.assets/spl-token.json',
            decimals: 9,
        });

        const ix = new TransactionInstruction({
            keys: [
                {
                    pubkey: tokenMintKeypair.publicKey,
                    isSigner: true,
                    isWritable: true,
                }, // Mint account
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

        const sx = await sendAndConfirmTransaction(connection, new Transaction().add(ix), [payer, tokenMintKeypair]);

        console.log('Success!');
        console.log(`   Mint Address: ${tokenMintKeypair.publicKey}`);
        console.log(`   Tx Signature: ${sx}`);
    });

    it('Create an NFT!', async () => {
        const metadataAddress = PublicKey.findProgramAddressSync(
            [Buffer.from('metadata'), TOKEN_METADATA_PROGRAM_ID.toBuffer(), nftMintKeypair.publicKey.toBuffer()],
            TOKEN_METADATA_PROGRAM_ID,
        )[0];

        const instructionData = borshSerialize(CreateTokenArgsSchema, {
            instruction: MyInstruction.Create,
            token_title: 'Homer NFT',
            token_symbol: 'HOMR',
            token_uri:
                'https://raw.githubusercontent.com/solana-developers/program-examples/new-examples/tokens/tokens/.assets/nft.json',
            decimals: 0,
        });

        const ix = new TransactionInstruction({
            keys: [
                { pubkey: nftMintKeypair.publicKey, isSigner: true, isWritable: true }, // Mint account
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

        const sx = await sendAndConfirmTransaction(connection, new Transaction().add(ix), [payer, nftMintKeypair]);

        console.log('Success!');
        console.log(`   Mint Address: ${nftMintKeypair.publicKey}`);
        console.log(`   Tx Signature: ${sx}`);
    });

    it('Mint some tokens to your wallet!', async () => {
        const associatedTokenAccountAddress = await getAssociatedTokenAddress(
            tokenMintKeypair.publicKey,
            payer.publicKey,
        );

        const instructionData = borshSerialize(MintSplArgsSchema, {
            instruction: MyInstruction.MintSpl,
            quantity: new BN(150),
        });

        const ix = new TransactionInstruction({
            keys: [
                {
                    pubkey: tokenMintKeypair.publicKey,
                    isSigner: false,
                    isWritable: true,
                }, // Mint account
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

    it('Mint the NFT to your wallet!', async () => {
        const metadataAddress = PublicKey.findProgramAddressSync(
            [Buffer.from('metadata'), TOKEN_METADATA_PROGRAM_ID.toBuffer(), nftMintKeypair.publicKey.toBuffer()],
            TOKEN_METADATA_PROGRAM_ID,
        )[0];

        const editionAddress = PublicKey.findProgramAddressSync(
            [
                Buffer.from('metadata'),
                TOKEN_METADATA_PROGRAM_ID.toBuffer(),
                nftMintKeypair.publicKey.toBuffer(),
                Buffer.from('edition'),
            ],
            TOKEN_METADATA_PROGRAM_ID,
        )[0];

        const associatedTokenAccountAddress = await getAssociatedTokenAddress(
            nftMintKeypair.publicKey,
            payer.publicKey,
        );

        const instructionData = borshSerialize(MintNftArgsSchema, {
            instruction: MyInstruction.MintNft,
        });

        const ix = new TransactionInstruction({
            keys: [
                { pubkey: nftMintKeypair.publicKey, isSigner: false, isWritable: true }, // Mint account
                { pubkey: metadataAddress, isSigner: false, isWritable: true }, // Metadata account
                { pubkey: editionAddress, isSigner: false, isWritable: true }, // Edition account
                { pubkey: payer.publicKey, isSigner: false, isWritable: true }, // Mint authority account
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

    it('Prep a new test wallet for transfers', async () => {
        await connection.confirmTransaction(
            await connection.requestAirdrop(
                recipientWallet.publicKey,
                await connection.getMinimumBalanceForRentExemption(0),
            ),
        );
        console.log(`Recipient Pubkey: ${recipientWallet.publicKey}`);
    });

    it('Transfer tokens to another wallet!', async () => {
        const fromAssociatedTokenAddress = await getAssociatedTokenAddress(tokenMintKeypair.publicKey, payer.publicKey);
        console.log(`Owner Token Address: ${fromAssociatedTokenAddress}`);
        const toAssociatedTokenAddress = await getAssociatedTokenAddress(
            tokenMintKeypair.publicKey,
            recipientWallet.publicKey,
        );
        console.log(`Recipient Token Address: ${toAssociatedTokenAddress}`);

        const transferToInstructionData = borshSerialize(TransferTokensArgsSchema, {
            instruction: MyInstruction.TransferTokens,
            quantity: new BN(15),
        });

        const ix = new TransactionInstruction({
            keys: [
                {
                    pubkey: tokenMintKeypair.publicKey,
                    isSigner: false,
                    isWritable: true,
                }, // Mint account
                {
                    pubkey: fromAssociatedTokenAddress,
                    isSigner: false,
                    isWritable: true,
                }, // Owner Token account
                { pubkey: toAssociatedTokenAddress, isSigner: false, isWritable: true }, // Recipient Token account
                { pubkey: payer.publicKey, isSigner: true, isWritable: true }, // Owner
                { pubkey: recipientWallet.publicKey, isSigner: true, isWritable: true }, // Recipient
                { pubkey: payer.publicKey, isSigner: true, isWritable: true }, // Payer
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // System program
                { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // Token program
                {
                    pubkey: ASSOCIATED_TOKEN_PROGRAM_ID,
                    isSigner: false,
                    isWritable: false,
                }, // Associated token program
            ],
            programId: program.publicKey,
            data: transferToInstructionData,
        });

        await sendAndConfirmTransaction(connection, new Transaction().add(ix), [payer, recipientWallet], {
            skipPreflight: true,
        });
    });

    it('Transfer NFT to another wallet!', async () => {
        const fromAssociatedTokenAddress = await getAssociatedTokenAddress(nftMintKeypair.publicKey, payer.publicKey);
        console.log(`Owner Token Address: ${fromAssociatedTokenAddress}`);
        const toAssociatedTokenAddress = await getAssociatedTokenAddress(
            nftMintKeypair.publicKey,
            recipientWallet.publicKey,
        );
        console.log(`Recipient Token Address: ${toAssociatedTokenAddress}`);

        const transferToInstructionData = borshSerialize(TransferTokensArgsSchema, {
            instruction: MyInstruction.TransferTokens,
            quantity: new BN(1),
        });

        const ix = new TransactionInstruction({
            keys: [
                { pubkey: nftMintKeypair.publicKey, isSigner: false, isWritable: true }, // Mint account
                {
                    pubkey: fromAssociatedTokenAddress,
                    isSigner: false,
                    isWritable: true,
                }, // Owner Token account
                { pubkey: toAssociatedTokenAddress, isSigner: false, isWritable: true }, // Recipient Token account
                { pubkey: payer.publicKey, isSigner: true, isWritable: true }, // Owner
                { pubkey: recipientWallet.publicKey, isSigner: true, isWritable: true }, // Recipient
                { pubkey: payer.publicKey, isSigner: true, isWritable: true }, // Payer
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // System program
                { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // Token program
                {
                    pubkey: ASSOCIATED_TOKEN_PROGRAM_ID,
                    isSigner: false,
                    isWritable: false,
                }, // Associated token program
            ],
            programId: program.publicKey,
            data: transferToInstructionData,
        });

        await sendAndConfirmTransaction(connection, new Transaction().add(ix), [payer, recipientWallet], {
            skipPreflight: true,
        });
    });
});
