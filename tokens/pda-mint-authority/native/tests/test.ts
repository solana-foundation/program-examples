import {
    AccountRole,
    address,
    type Address,
    appendTransactionMessageInstruction,
    createTransactionMessage,
    generateKeyPairSigner,
    getAddressEncoder,
    getProgramDerivedAddress,
    type Instruction,
    type KeyPairSigner,
    lamports,
    pipe,
    setTransactionMessageFeePayerSigner,
    signTransactionMessageWithSigners,
    unwrapOption,
} from '@solana/kit';
import { SYSTEM_PROGRAM_ADDRESS } from '@solana-program/system';
import {
    ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
    findAssociatedTokenPda,
    getMintDecoder,
    getTokenDecoder,
    TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token';
import { assert } from 'chai';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';
import {
    borshSerialize,
    CreateTokenArgsSchema,
    InitArgsSchema,
    MintToArgsSchema,
    NftMinterInstruction,
} from './instructions';

const TOKEN_METADATA_PROGRAM_ID = address('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
const SYSVAR_RENT_ADDRESS = address('SysvarRent111111111111111111111111111111111');

const addressEncoder = getAddressEncoder();

describe('NFT Minter', () => {
    const svm = new LiteSVM();
    let programId: Address;
    let payer: KeyPairSigner;
    let mintKeypair: KeyPairSigner;
    let mintAuthorityAddress: Address;
    let mintAuthorityBump: number;
    let metadataAddress: Address;
    let editionAddress: Address;

    before(async () => {
        programId = (await generateKeyPairSigner()).address;
        svm.addProgramFromFile(programId, 'tests/fixtures/pda_mint_authority_native_program.so');
        svm.addProgramFromFile(TOKEN_METADATA_PROGRAM_ID, 'tests/fixtures/token_metadata.so');

        payer = await generateKeyPairSigner();
        svm.airdrop(payer.address, lamports(10_000_000_000n));

        [mintAuthorityAddress, mintAuthorityBump] = await getProgramDerivedAddress({
            programAddress: programId,
            seeds: ['mint_authority'],
        });

        mintKeypair = await generateKeyPairSigner();

        [metadataAddress] = await getProgramDerivedAddress({
            programAddress: TOKEN_METADATA_PROGRAM_ID,
            seeds: [
                'metadata',
                addressEncoder.encode(TOKEN_METADATA_PROGRAM_ID),
                addressEncoder.encode(mintKeypair.address),
            ],
        });

        [editionAddress] = await getProgramDerivedAddress({
            programAddress: TOKEN_METADATA_PROGRAM_ID,
            seeds: [
                'metadata',
                addressEncoder.encode(TOKEN_METADATA_PROGRAM_ID),
                addressEncoder.encode(mintKeypair.address),
                'edition',
            ],
        });
    });

    async function sendTransaction(ix: Instruction) {
        const transactionMessage = pipe(
            createTransactionMessage({ version: 0 }),
            m => setTransactionMessageFeePayerSigner(payer, m),
            m => svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
            m => appendTransactionMessageInstruction(ix, m),
        );
        const signedTx = await signTransactionMessageWithSigners(transactionMessage);
        const result = svm.sendTransaction(signedTx);
        assert(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);
    }

    it('Init Mint Authority PDA', async () => {
        const instructionData = borshSerialize(InitArgsSchema, {
            instruction: NftMinterInstruction.Init,
        });

        const ix = {
            programAddress: programId,
            accounts: [
                { address: mintAuthorityAddress, role: AccountRole.WRITABLE },
                { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ],
            data: new Uint8Array(instructionData),
        };

        await sendTransaction(ix);

        const mintAuthorityInfo = svm.getAccount(mintAuthorityAddress);
        assert(mintAuthorityInfo.exists, 'mint authority PDA not created');
        assert(mintAuthorityInfo.programAddress === programId, 'mint authority PDA not owned by the program');
        assert.equal(mintAuthorityInfo.data[0], mintAuthorityBump, 'unexpected bump stored in the PDA');
    });

    it('Create an NFT!', async () => {
        const instructionData = borshSerialize(CreateTokenArgsSchema, {
            instruction: NftMinterInstruction.Create,
            nft_title: 'Homer NFT',
            nft_symbol: 'HOMR',
            nft_uri:
                'https://raw.githubusercontent.com/solana-developers/program-examples/new-examples/tokens/tokens/.assets/nft.json',
        });

        const ix = {
            programAddress: programId,
            accounts: [
                { address: mintKeypair.address, role: AccountRole.WRITABLE_SIGNER, signer: mintKeypair }, // Mint account
                { address: mintAuthorityAddress, role: AccountRole.WRITABLE }, // Mint authority account
                { address: metadataAddress, role: AccountRole.WRITABLE }, // Metadata account
                { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer }, // Payer
                { address: SYSVAR_RENT_ADDRESS, role: AccountRole.READONLY }, // Rent account
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY }, // System program
                { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY }, // Token program
                { address: TOKEN_METADATA_PROGRAM_ID, role: AccountRole.READONLY }, // Token metadata program
            ],
            data: new Uint8Array(instructionData),
        };

        await sendTransaction(ix);

        const mintInfo = svm.getAccount(mintKeypair.address);
        assert(mintInfo.exists, 'mint account not created');
        assert(mintInfo.programAddress === TOKEN_PROGRAM_ADDRESS, 'mint account not owned by the token program');

        const mint = getMintDecoder().decode(mintInfo.data);
        assert.equal(mint.decimals, 0, 'unexpected decimals');
        assert(unwrapOption(mint.mintAuthority) === mintAuthorityAddress, 'mint authority is not the PDA');

        const metadataInfo = svm.getAccount(metadataAddress);
        assert(metadataInfo.exists, 'metadata account not created');
        assert(metadataInfo.programAddress === TOKEN_METADATA_PROGRAM_ID, 'metadata account has wrong owner');
    });

    it('Mint the NFT to your wallet!', async () => {
        const [associatedTokenAccountAddress] = await findAssociatedTokenPda({
            mint: mintKeypair.address,
            owner: payer.address,
            tokenProgram: TOKEN_PROGRAM_ADDRESS,
        });

        const instructionData = borshSerialize(MintToArgsSchema, {
            instruction: NftMinterInstruction.Mint,
        });

        const ix = {
            programAddress: programId,
            accounts: [
                { address: mintKeypair.address, role: AccountRole.WRITABLE }, // Mint account
                { address: metadataAddress, role: AccountRole.WRITABLE }, // Metadata account
                { address: editionAddress, role: AccountRole.WRITABLE }, // Edition account
                { address: mintAuthorityAddress, role: AccountRole.WRITABLE }, // Mint authority account
                { address: associatedTokenAccountAddress, role: AccountRole.WRITABLE }, // ATA
                { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer }, // Payer
                { address: SYSVAR_RENT_ADDRESS, role: AccountRole.READONLY }, // Rent account
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY }, // System program
                { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY }, // Token program
                { address: ASSOCIATED_TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY }, // Associated token program
                { address: TOKEN_METADATA_PROGRAM_ID, role: AccountRole.READONLY }, // Token metadata program
            ],
            data: new Uint8Array(instructionData),
        };

        await sendTransaction(ix);

        const tokenInfo = svm.getAccount(associatedTokenAccountAddress);
        assert(tokenInfo.exists, 'associated token account not created');
        const tokenAccount = getTokenDecoder().decode(tokenInfo.data);
        assert.equal(tokenAccount.amount.toString(), '1', 'unexpected NFT balance');

        const editionInfo = svm.getAccount(editionAddress);
        assert(editionInfo.exists, 'edition account not created');
        assert(editionInfo.programAddress === TOKEN_METADATA_PROGRAM_ID, 'edition account has wrong owner');
    });
});
