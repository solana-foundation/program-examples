import { Buffer } from 'node:buffer';
import { MintLayout, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import {
    Keypair,
    LAMPORTS_PER_SOL,
    PublicKey,
    SYSVAR_RENT_PUBKEY,
    SystemProgram,
    Transaction,
    TransactionInstruction,
} from '@solana/web3.js';
import * as borsh from 'borsh';
import { assert } from 'chai';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';

const PROGRAM_ID = PublicKey.unique();
const TOKEN_METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

const CreateTokenArgsSchema = {
    struct: {
        token_title: 'string',
        token_symbol: 'string',
        token_uri: 'string',
        token_decimals: 'u8',
    },
};

function borshSerialize(schema: borsh.Schema, data: object): Buffer {
    return Buffer.from(borsh.serialize(schema, data));
}

describe('Create Tokens!', () => {
    const svm = new LiteSVM();
    svm.addProgramFromFile(PROGRAM_ID, 'tests/fixtures/create_token_program.so');
    svm.addProgramFromFile(TOKEN_METADATA_PROGRAM_ID, 'tests/fixtures/token_metadata.so');

    const payer = Keypair.generate();
    svm.airdrop(payer.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

    function findMetadataPda(mint: PublicKey): PublicKey {
        return PublicKey.findProgramAddressSync(
            [Buffer.from('metadata'), TOKEN_METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
            TOKEN_METADATA_PROGRAM_ID,
        )[0];
    }

    function createToken(tokenDecimals: number, tokenTitle: string, tokenSymbol: string, tokenUri: string): Keypair {
        const mintKeypair = Keypair.generate();
        const metadataAddress = findMetadataPda(mintKeypair.publicKey);

        const instructionData = borshSerialize(CreateTokenArgsSchema, {
            token_title: tokenTitle,
            token_symbol: tokenSymbol,
            token_uri: tokenUri,
            token_decimals: tokenDecimals,
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
                { pubkey: TOKEN_METADATA_PROGRAM_ID, isSigner: false, isWritable: false }, // Token metadata program
            ],
            programId: PROGRAM_ID,
            data: instructionData,
        });

        const tx = new Transaction();
        tx.recentBlockhash = svm.latestBlockhash();
        tx.add(ix).sign(payer, mintKeypair);
        const result = svm.sendTransaction(tx);
        assert(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);

        return mintKeypair;
    }

    it('Create an SPL Token!', () => {
        // SPL Token default = 9 decimals
        const mintKeypair = createToken(
            9,
            'Solana Gold',
            'GOLDSOL',
            'https://raw.githubusercontent.com/solana-developers/program-examples/new-examples/tokens/tokens/.assets/spl-token.json',
        );

        const mintInfo = svm.getAccount(mintKeypair.publicKey);
        assert(mintInfo !== null, 'mint account not created');
        assert(mintInfo.owner.equals(TOKEN_PROGRAM_ID), 'mint account not owned by the token program');

        const mint = MintLayout.decode(Buffer.from(mintInfo.data));
        assert(mint.isInitialized, 'mint not initialized');
        assert.equal(mint.decimals, 9, 'unexpected decimals');
        assert(mint.mintAuthority.equals(payer.publicKey), 'unexpected mint authority');

        const metadataInfo = svm.getAccount(findMetadataPda(mintKeypair.publicKey));
        assert(metadataInfo !== null, 'metadata account not created');
        assert(metadataInfo.owner.equals(TOKEN_METADATA_PROGRAM_ID), 'metadata account has wrong owner');
    });

    it('Create an NFT!', () => {
        // NFT default = 0 decimals
        const mintKeypair = createToken(
            0,
            'Homer NFT',
            'HOMR',
            'https://raw.githubusercontent.com/solana-developers/program-examples/new-examples/tokens/tokens/.assets/nft.json',
        );

        const mintInfo = svm.getAccount(mintKeypair.publicKey);
        assert(mintInfo !== null, 'mint account not created');
        assert(mintInfo.owner.equals(TOKEN_PROGRAM_ID), 'mint account not owned by the token program');

        const mint = MintLayout.decode(Buffer.from(mintInfo.data));
        assert(mint.isInitialized, 'mint not initialized');
        assert.equal(mint.decimals, 0, 'unexpected decimals');
        assert(mint.mintAuthority.equals(payer.publicKey), 'unexpected mint authority');

        const metadataInfo = svm.getAccount(findMetadataPda(mintKeypair.publicKey));
        assert(metadataInfo !== null, 'metadata account not created');
        assert(metadataInfo.owner.equals(TOKEN_METADATA_PROGRAM_ID), 'metadata account has wrong owner');
    });
});
