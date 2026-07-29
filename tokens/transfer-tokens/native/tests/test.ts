import { Buffer } from 'node:buffer';
import {
    AccountLayout,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    getAssociatedTokenAddressSync,
    MintLayout,
    TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import {
    Keypair,
    LAMPORTS_PER_SOL,
    PublicKey,
    SYSVAR_RENT_PUBKEY,
    SystemProgram,
    Transaction,
    TransactionInstruction,
} from '@solana/web3.js';
import { assert } from 'chai';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';
import {
    borshSerialize,
    CreateTokenArgsSchema,
    MintNftArgsSchema,
    MintSplArgsSchema,
    MyInstruction,
    TransferTokensArgsSchema,
} from './instructions';

const PROGRAM_ID = PublicKey.unique();
const TOKEN_METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

describe('Transferring Tokens', () => {
    const svm = new LiteSVM();
    svm.addProgramFromFile(PROGRAM_ID, 'tests/fixtures/transfer_tokens_program.so');
    svm.addProgramFromFile(TOKEN_METADATA_PROGRAM_ID, 'tests/fixtures/token_metadata.so');

    const payer = Keypair.generate();
    svm.airdrop(payer.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

    const recipientWallet = Keypair.generate();
    svm.airdrop(recipientWallet.publicKey, BigInt(LAMPORTS_PER_SOL));

    const tokenMintKeypair = Keypair.generate();
    const nftMintKeypair = Keypair.generate();

    function sendTransaction(ix: TransactionInstruction, signers: Keypair[]) {
        const tx = new Transaction();
        tx.recentBlockhash = svm.latestBlockhash();
        tx.add(ix).sign(...signers);
        const result = svm.sendTransaction(tx);
        assert(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);
    }

    function findMetadataPda(mint: PublicKey): PublicKey {
        return PublicKey.findProgramAddressSync(
            [Buffer.from('metadata'), TOKEN_METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
            TOKEN_METADATA_PROGRAM_ID,
        )[0];
    }

    function findEditionPda(mint: PublicKey): PublicKey {
        return PublicKey.findProgramAddressSync(
            [Buffer.from('metadata'), TOKEN_METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer(), Buffer.from('edition')],
            TOKEN_METADATA_PROGRAM_ID,
        )[0];
    }

    function tokenBalance(tokenAccount: PublicKey): string {
        const info = svm.getAccount(tokenAccount);
        assert(info !== null, `token account ${tokenAccount} does not exist`);
        return AccountLayout.decode(Buffer.from(info.data)).amount.toString();
    }

    function createToken(mintKeypair: Keypair, decimals: number, title: string, symbol: string, uri: string) {
        const instructionData = borshSerialize(CreateTokenArgsSchema, {
            instruction: MyInstruction.Create,
            token_title: title,
            token_symbol: symbol,
            token_uri: uri,
            decimals,
        });

        const ix = new TransactionInstruction({
            keys: [
                { pubkey: mintKeypair.publicKey, isSigner: true, isWritable: true }, // Mint account
                { pubkey: payer.publicKey, isSigner: false, isWritable: true }, // Mint authority account
                { pubkey: findMetadataPda(mintKeypair.publicKey), isSigner: false, isWritable: true }, // Metadata account
                { pubkey: payer.publicKey, isSigner: true, isWritable: true }, // Payer
                { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false }, // Rent account
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // System program
                { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // Token program
                { pubkey: TOKEN_METADATA_PROGRAM_ID, isSigner: false, isWritable: false }, // Token metadata program
            ],
            programId: PROGRAM_ID,
            data: instructionData,
        });

        sendTransaction(ix, [payer, mintKeypair]);
    }

    it('Create an SPL Token!', () => {
        createToken(
            tokenMintKeypair,
            9,
            'Solana Gold',
            'GOLDSOL',
            'https://raw.githubusercontent.com/solana-developers/program-examples/new-examples/tokens/tokens/.assets/spl-token.json',
        );

        const mintInfo = svm.getAccount(tokenMintKeypair.publicKey);
        assert(mintInfo !== null, 'mint account not created');
        assert(mintInfo.owner.equals(TOKEN_PROGRAM_ID), 'mint account not owned by the token program');

        const mint = MintLayout.decode(Buffer.from(mintInfo.data));
        assert.equal(mint.decimals, 9, 'unexpected decimals');
        assert(mint.mintAuthority.equals(payer.publicKey), 'unexpected mint authority');

        const metadataInfo = svm.getAccount(findMetadataPda(tokenMintKeypair.publicKey));
        assert(metadataInfo !== null, 'metadata account not created');
        assert(metadataInfo.owner.equals(TOKEN_METADATA_PROGRAM_ID), 'metadata account has wrong owner');
    });

    it('Create an NFT!', () => {
        createToken(
            nftMintKeypair,
            0,
            'Homer NFT',
            'HOMR',
            'https://raw.githubusercontent.com/solana-developers/program-examples/new-examples/tokens/tokens/.assets/nft.json',
        );

        const mintInfo = svm.getAccount(nftMintKeypair.publicKey);
        assert(mintInfo !== null, 'mint account not created');

        const mint = MintLayout.decode(Buffer.from(mintInfo.data));
        assert.equal(mint.decimals, 0, 'unexpected decimals');

        const metadataInfo = svm.getAccount(findMetadataPda(nftMintKeypair.publicKey));
        assert(metadataInfo !== null, 'metadata account not created');
    });

    it('Mint some tokens to your wallet!', () => {
        const associatedTokenAccountAddress = getAssociatedTokenAddressSync(
            tokenMintKeypair.publicKey,
            payer.publicKey,
        );

        const instructionData = borshSerialize(MintSplArgsSchema, {
            instruction: MyInstruction.MintSpl,
            quantity: BigInt(150),
        });

        const ix = new TransactionInstruction({
            keys: [
                { pubkey: tokenMintKeypair.publicKey, isSigner: false, isWritable: true }, // Mint account
                { pubkey: payer.publicKey, isSigner: false, isWritable: true }, // Mint authority account
                { pubkey: associatedTokenAccountAddress, isSigner: false, isWritable: true }, // ATA
                { pubkey: payer.publicKey, isSigner: true, isWritable: true }, // Payer
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // System program
                { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // Token program
                { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // Associated token program
            ],
            programId: PROGRAM_ID,
            data: instructionData,
        });

        sendTransaction(ix, [payer]);

        assert.equal(tokenBalance(associatedTokenAccountAddress), '150', 'unexpected token balance');

        const mint = MintLayout.decode(Buffer.from(svm.getAccount(tokenMintKeypair.publicKey).data));
        assert.equal(mint.supply.toString(), '150', 'unexpected mint supply');
    });

    it('Mint the NFT to your wallet!', () => {
        const editionAddress = findEditionPda(nftMintKeypair.publicKey);
        const associatedTokenAccountAddress = getAssociatedTokenAddressSync(nftMintKeypair.publicKey, payer.publicKey);

        const instructionData = borshSerialize(MintNftArgsSchema, {
            instruction: MyInstruction.MintNft,
        });

        const ix = new TransactionInstruction({
            keys: [
                { pubkey: nftMintKeypair.publicKey, isSigner: false, isWritable: true }, // Mint account
                { pubkey: findMetadataPda(nftMintKeypair.publicKey), isSigner: false, isWritable: true }, // Metadata account
                { pubkey: editionAddress, isSigner: false, isWritable: true }, // Edition account
                { pubkey: payer.publicKey, isSigner: false, isWritable: true }, // Mint authority account
                { pubkey: associatedTokenAccountAddress, isSigner: false, isWritable: true }, // ATA
                { pubkey: payer.publicKey, isSigner: true, isWritable: true }, // Payer
                { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false }, // Rent account
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // System program
                { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // Token program
                { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // Associated token program
                { pubkey: TOKEN_METADATA_PROGRAM_ID, isSigner: false, isWritable: false }, // Token metadata program
            ],
            programId: PROGRAM_ID,
            data: instructionData,
        });

        sendTransaction(ix, [payer]);

        assert.equal(tokenBalance(associatedTokenAccountAddress), '1', 'unexpected NFT balance');

        const editionInfo = svm.getAccount(editionAddress);
        assert(editionInfo !== null, 'edition account not created');
        assert(editionInfo.owner.equals(TOKEN_METADATA_PROGRAM_ID), 'edition account has wrong owner');

        const mint = MintLayout.decode(Buffer.from(svm.getAccount(nftMintKeypair.publicKey).data));
        assert(mint.mintAuthority.equals(editionAddress), 'mint authority not transferred to the edition');
    });

    function transferTokens(mint: PublicKey, quantity: bigint) {
        const fromAssociatedTokenAddress = getAssociatedTokenAddressSync(mint, payer.publicKey);
        const toAssociatedTokenAddress = getAssociatedTokenAddressSync(mint, recipientWallet.publicKey);

        const instructionData = borshSerialize(TransferTokensArgsSchema, {
            instruction: MyInstruction.TransferTokens,
            quantity,
        });

        const ix = new TransactionInstruction({
            keys: [
                { pubkey: mint, isSigner: false, isWritable: true }, // Mint account
                { pubkey: fromAssociatedTokenAddress, isSigner: false, isWritable: true }, // Owner Token account
                { pubkey: toAssociatedTokenAddress, isSigner: false, isWritable: true }, // Recipient Token account
                { pubkey: payer.publicKey, isSigner: true, isWritable: true }, // Owner
                { pubkey: recipientWallet.publicKey, isSigner: true, isWritable: true }, // Recipient
                { pubkey: payer.publicKey, isSigner: true, isWritable: true }, // Payer
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // System program
                { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // Token program
                { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // Associated token program
            ],
            programId: PROGRAM_ID,
            data: instructionData,
        });

        sendTransaction(ix, [payer, recipientWallet]);
    }

    it('Transfer tokens to another wallet!', () => {
        transferTokens(tokenMintKeypair.publicKey, BigInt(15));

        const fromAta = getAssociatedTokenAddressSync(tokenMintKeypair.publicKey, payer.publicKey);
        const toAta = getAssociatedTokenAddressSync(tokenMintKeypair.publicKey, recipientWallet.publicKey);
        assert.equal(tokenBalance(toAta), '15', 'unexpected recipient balance');
        assert.equal(tokenBalance(fromAta), '135', 'unexpected sender balance');
    });

    it('Transfer NFT to another wallet!', () => {
        transferTokens(nftMintKeypair.publicKey, BigInt(1));

        const fromAta = getAssociatedTokenAddressSync(nftMintKeypair.publicKey, payer.publicKey);
        const toAta = getAssociatedTokenAddressSync(nftMintKeypair.publicKey, recipientWallet.publicKey);
        assert.equal(tokenBalance(toAta), '1', 'unexpected recipient NFT balance');
        assert.equal(tokenBalance(fromAta), '0', 'unexpected sender NFT balance');
    });
});
