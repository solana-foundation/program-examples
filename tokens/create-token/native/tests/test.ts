import { Buffer } from 'node:buffer';
import {
    AccountRole,
    address,
    type Address,
    appendTransactionMessageInstruction,
    createTransactionMessage,
    generateKeyPairSigner,
    getAddressEncoder,
    getProgramDerivedAddress,
    type KeyPairSigner,
    lamports,
    pipe,
    setTransactionMessageFeePayerSigner,
    signTransactionMessageWithSigners,
    unwrapOption,
} from '@solana/kit';
import { SYSTEM_PROGRAM_ADDRESS } from '@solana-program/system';
import { getMintDecoder, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import * as borsh from 'borsh';
import { assert } from 'chai';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';

const TOKEN_METADATA_PROGRAM_ID = address('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
const SYSVAR_RENT_ADDRESS = address('SysvarRent111111111111111111111111111111111');

const CreateTokenArgsSchema: borsh.Schema = {
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

const addressEncoder = getAddressEncoder();

describe('Create Tokens!', () => {
    const svm = new LiteSVM();
    let programId: Address;
    let payer: KeyPairSigner;

    before(async () => {
        programId = (await generateKeyPairSigner()).address;
        svm.addProgramFromFile(programId, 'tests/fixtures/create_token_program.so');
        svm.addProgramFromFile(TOKEN_METADATA_PROGRAM_ID, 'tests/fixtures/token_metadata.so');

        payer = await generateKeyPairSigner();
        svm.airdrop(payer.address, lamports(10_000_000_000n));
    });

    async function findMetadataPda(mint: Address): Promise<Address> {
        const [metadataAddress] = await getProgramDerivedAddress({
            programAddress: TOKEN_METADATA_PROGRAM_ID,
            seeds: ['metadata', addressEncoder.encode(TOKEN_METADATA_PROGRAM_ID), addressEncoder.encode(mint)],
        });
        return metadataAddress;
    }

    async function createToken(
        tokenDecimals: number,
        tokenTitle: string,
        tokenSymbol: string,
        tokenUri: string,
    ): Promise<KeyPairSigner> {
        const mintKeypair = await generateKeyPairSigner();
        const metadataAddress = await findMetadataPda(mintKeypair.address);

        const instructionData = borshSerialize(CreateTokenArgsSchema, {
            token_title: tokenTitle,
            token_symbol: tokenSymbol,
            token_uri: tokenUri,
            token_decimals: tokenDecimals,
        });

        const ix = {
            programAddress: programId,
            accounts: [
                { address: mintKeypair.address, role: AccountRole.WRITABLE_SIGNER, signer: mintKeypair }, // Mint account
                { address: payer.address, role: AccountRole.WRITABLE }, // Mint authority account
                { address: metadataAddress, role: AccountRole.WRITABLE }, // Metadata account
                { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer }, // Payer
                { address: SYSVAR_RENT_ADDRESS, role: AccountRole.READONLY }, // Rent account
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY }, // System program
                { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY }, // Token program
                { address: TOKEN_METADATA_PROGRAM_ID, role: AccountRole.READONLY }, // Token metadata program
            ],
            data: new Uint8Array(instructionData),
        };

        const transactionMessage = pipe(
            createTransactionMessage({ version: 0 }),
            m => setTransactionMessageFeePayerSigner(payer, m),
            m => svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
            m => appendTransactionMessageInstruction(ix, m),
        );
        const signedTx = await signTransactionMessageWithSigners(transactionMessage);
        const result = svm.sendTransaction(signedTx);
        assert(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);

        return mintKeypair;
    }

    it('Create an SPL Token!', async () => {
        // SPL Token default = 9 decimals
        const mintKeypair = await createToken(
            9,
            'Solana Gold',
            'GOLDSOL',
            'https://raw.githubusercontent.com/solana-developers/program-examples/new-examples/tokens/tokens/.assets/spl-token.json',
        );

        const mintInfo = svm.getAccount(mintKeypair.address);
        assert(mintInfo.exists, 'mint account not created');
        assert(mintInfo.programAddress === TOKEN_PROGRAM_ADDRESS, 'mint account not owned by the token program');

        const mint = getMintDecoder().decode(mintInfo.data);
        assert(mint.isInitialized, 'mint not initialized');
        assert.equal(mint.decimals, 9, 'unexpected decimals');
        assert(unwrapOption(mint.mintAuthority) === payer.address, 'unexpected mint authority');

        const metadataInfo = svm.getAccount(await findMetadataPda(mintKeypair.address));
        assert(metadataInfo.exists, 'metadata account not created');
        assert(metadataInfo.programAddress === TOKEN_METADATA_PROGRAM_ID, 'metadata account has wrong owner');
    });

    it('Create an NFT!', async () => {
        // NFT default = 0 decimals
        const mintKeypair = await createToken(
            0,
            'Homer NFT',
            'HOMR',
            'https://raw.githubusercontent.com/solana-developers/program-examples/new-examples/tokens/tokens/.assets/nft.json',
        );

        const mintInfo = svm.getAccount(mintKeypair.address);
        assert(mintInfo.exists, 'mint account not created');
        assert(mintInfo.programAddress === TOKEN_PROGRAM_ADDRESS, 'mint account not owned by the token program');

        const mint = getMintDecoder().decode(mintInfo.data);
        assert(mint.isInitialized, 'mint not initialized');
        assert.equal(mint.decimals, 0, 'unexpected decimals');
        assert(unwrapOption(mint.mintAuthority) === payer.address, 'unexpected mint authority');

        const metadataInfo = svm.getAccount(await findMetadataPda(mintKeypair.address));
        assert(metadataInfo.exists, 'metadata account not created');
        assert(metadataInfo.programAddress === TOKEN_METADATA_PROGRAM_ID, 'metadata account has wrong owner');
    });
});
