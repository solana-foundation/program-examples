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
    InitArgsSchema,
    MintToArgsSchema,
    NftMinterInstruction,
} from './instructions';

const PROGRAM_ID = PublicKey.unique();
const TOKEN_METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

describe('NFT Minter', () => {
    const svm = new LiteSVM();
    svm.addProgramFromFile(PROGRAM_ID, 'tests/fixtures/pda_mint_authority_native_program.so');
    svm.addProgramFromFile(TOKEN_METADATA_PROGRAM_ID, 'tests/fixtures/token_metadata.so');

    const payer = Keypair.generate();
    svm.airdrop(payer.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

    const [mintAuthorityPublicKey, mintAuthorityBump] = PublicKey.findProgramAddressSync(
        [Buffer.from('mint_authority')],
        PROGRAM_ID,
    );

    const mintKeypair = Keypair.generate();

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

    function sendTransaction(ix: TransactionInstruction, signers: Keypair[]) {
        const tx = new Transaction();
        tx.recentBlockhash = svm.latestBlockhash();
        tx.add(ix).sign(...signers);
        const result = svm.sendTransaction(tx);
        assert(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);
    }

    it('Init Mint Authority PDA', () => {
        const instructionData = borshSerialize(InitArgsSchema, {
            instruction: NftMinterInstruction.Init,
        });

        const ix = new TransactionInstruction({
            keys: [
                { pubkey: mintAuthorityPublicKey, isSigner: false, isWritable: true },
                { pubkey: payer.publicKey, isSigner: true, isWritable: true },
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            ],
            programId: PROGRAM_ID,
            data: instructionData,
        });

        sendTransaction(ix, [payer]);

        const mintAuthorityInfo = svm.getAccount(mintAuthorityPublicKey);
        assert(mintAuthorityInfo !== null, 'mint authority PDA not created');
        assert(mintAuthorityInfo.owner.equals(PROGRAM_ID), 'mint authority PDA not owned by the program');
        assert.equal(mintAuthorityInfo.data[0], mintAuthorityBump, 'unexpected bump stored in the PDA');
    });

    it('Create an NFT!', () => {
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
                { pubkey: TOKEN_METADATA_PROGRAM_ID, isSigner: false, isWritable: false }, // Token metadata program
            ],
            programId: PROGRAM_ID,
            data: instructionData,
        });

        sendTransaction(ix, [payer, mintKeypair]);

        const mintInfo = svm.getAccount(mintKeypair.publicKey);
        assert(mintInfo !== null, 'mint account not created');
        assert(mintInfo.owner.equals(TOKEN_PROGRAM_ID), 'mint account not owned by the token program');

        const mint = MintLayout.decode(Buffer.from(mintInfo.data));
        assert.equal(mint.decimals, 0, 'unexpected decimals');
        assert(mint.mintAuthority.equals(mintAuthorityPublicKey), 'mint authority is not the PDA');

        const metadataInfo = svm.getAccount(metadataAddress);
        assert(metadataInfo !== null, 'metadata account not created');
        assert(metadataInfo.owner.equals(TOKEN_METADATA_PROGRAM_ID), 'metadata account has wrong owner');
    });

    it('Mint the NFT to your wallet!', () => {
        const associatedTokenAccountAddress = getAssociatedTokenAddressSync(mintKeypair.publicKey, payer.publicKey);

        const instructionData = borshSerialize(MintToArgsSchema, {
            instruction: NftMinterInstruction.Mint,
        });

        const ix = new TransactionInstruction({
            keys: [
                { pubkey: mintKeypair.publicKey, isSigner: false, isWritable: true }, // Mint account
                { pubkey: metadataAddress, isSigner: false, isWritable: true }, // Metadata account
                { pubkey: editionAddress, isSigner: false, isWritable: true }, // Edition account
                { pubkey: mintAuthorityPublicKey, isSigner: false, isWritable: true }, // Mint authority account
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

        const tokenInfo = svm.getAccount(associatedTokenAccountAddress);
        assert(tokenInfo !== null, 'associated token account not created');
        const tokenAccount = AccountLayout.decode(Buffer.from(tokenInfo.data));
        assert.equal(tokenAccount.amount.toString(), '1', 'unexpected NFT balance');

        const editionInfo = svm.getAccount(editionAddress);
        assert(editionInfo !== null, 'edition account not created');
        assert(editionInfo.owner.equals(TOKEN_METADATA_PROGRAM_ID), 'edition account has wrong owner');
    });
});
