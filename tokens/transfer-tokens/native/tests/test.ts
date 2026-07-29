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
    MintNftArgsSchema,
    MintSplArgsSchema,
    MyInstruction,
    TransferTokensArgsSchema,
} from './instructions';

const TOKEN_METADATA_PROGRAM_ID = address('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
const SYSVAR_RENT_ADDRESS = address('SysvarRent111111111111111111111111111111111');

const addressEncoder = getAddressEncoder();

describe('Transferring Tokens', () => {
    const svm = new LiteSVM();
    let programId: Address;
    let payer: KeyPairSigner;
    let recipientWallet: KeyPairSigner;
    let tokenMintKeypair: KeyPairSigner;
    let nftMintKeypair: KeyPairSigner;

    before(async () => {
        programId = (await generateKeyPairSigner()).address;
        svm.addProgramFromFile(programId, 'tests/fixtures/transfer_tokens_program.so');
        svm.addProgramFromFile(TOKEN_METADATA_PROGRAM_ID, 'tests/fixtures/token_metadata.so');

        payer = await generateKeyPairSigner();
        svm.airdrop(payer.address, lamports(10_000_000_000n));

        recipientWallet = await generateKeyPairSigner();
        svm.airdrop(recipientWallet.address, lamports(1_000_000_000n));

        tokenMintKeypair = await generateKeyPairSigner();
        nftMintKeypair = await generateKeyPairSigner();
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

    async function findMetadataPda(mint: Address): Promise<Address> {
        const [metadataAddress] = await getProgramDerivedAddress({
            programAddress: TOKEN_METADATA_PROGRAM_ID,
            seeds: ['metadata', addressEncoder.encode(TOKEN_METADATA_PROGRAM_ID), addressEncoder.encode(mint)],
        });
        return metadataAddress;
    }

    async function findEditionPda(mint: Address): Promise<Address> {
        const [editionAddress] = await getProgramDerivedAddress({
            programAddress: TOKEN_METADATA_PROGRAM_ID,
            seeds: [
                'metadata',
                addressEncoder.encode(TOKEN_METADATA_PROGRAM_ID),
                addressEncoder.encode(mint),
                'edition',
            ],
        });
        return editionAddress;
    }

    async function findAssociatedTokenAddress(mint: Address, owner: Address): Promise<Address> {
        const [associatedTokenAddress] = await findAssociatedTokenPda({
            mint,
            owner,
            tokenProgram: TOKEN_PROGRAM_ADDRESS,
        });
        return associatedTokenAddress;
    }

    function tokenBalance(tokenAccount: Address): string {
        const info = svm.getAccount(tokenAccount);
        assert(info.exists, `token account ${tokenAccount} does not exist`);
        return getTokenDecoder().decode(info.data).amount.toString();
    }

    async function createToken(
        mintKeypair: KeyPairSigner,
        decimals: number,
        title: string,
        symbol: string,
        uri: string,
    ) {
        const instructionData = borshSerialize(CreateTokenArgsSchema, {
            instruction: MyInstruction.Create,
            token_title: title,
            token_symbol: symbol,
            token_uri: uri,
            decimals,
        });

        const ix = {
            programAddress: programId,
            accounts: [
                { address: mintKeypair.address, role: AccountRole.WRITABLE_SIGNER, signer: mintKeypair }, // Mint account
                { address: payer.address, role: AccountRole.WRITABLE }, // Mint authority account
                { address: await findMetadataPda(mintKeypair.address), role: AccountRole.WRITABLE }, // Metadata account
                { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer }, // Payer
                { address: SYSVAR_RENT_ADDRESS, role: AccountRole.READONLY }, // Rent account
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY }, // System program
                { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY }, // Token program
                { address: TOKEN_METADATA_PROGRAM_ID, role: AccountRole.READONLY }, // Token metadata program
            ],
            data: new Uint8Array(instructionData),
        };

        await sendTransaction(ix);
    }

    it('Create an SPL Token!', async () => {
        await createToken(
            tokenMintKeypair,
            9,
            'Solana Gold',
            'GOLDSOL',
            'https://raw.githubusercontent.com/solana-developers/program-examples/new-examples/tokens/tokens/.assets/spl-token.json',
        );

        const mintInfo = svm.getAccount(tokenMintKeypair.address);
        assert(mintInfo.exists, 'mint account not created');
        assert(mintInfo.programAddress === TOKEN_PROGRAM_ADDRESS, 'mint account not owned by the token program');

        const mint = getMintDecoder().decode(mintInfo.data);
        assert.equal(mint.decimals, 9, 'unexpected decimals');
        assert(unwrapOption(mint.mintAuthority) === payer.address, 'unexpected mint authority');

        const metadataInfo = svm.getAccount(await findMetadataPda(tokenMintKeypair.address));
        assert(metadataInfo.exists, 'metadata account not created');
        assert(metadataInfo.programAddress === TOKEN_METADATA_PROGRAM_ID, 'metadata account has wrong owner');
    });

    it('Create an NFT!', async () => {
        await createToken(
            nftMintKeypair,
            0,
            'Homer NFT',
            'HOMR',
            'https://raw.githubusercontent.com/solana-developers/program-examples/new-examples/tokens/tokens/.assets/nft.json',
        );

        const mintInfo = svm.getAccount(nftMintKeypair.address);
        assert(mintInfo.exists, 'mint account not created');

        const mint = getMintDecoder().decode(mintInfo.data);
        assert.equal(mint.decimals, 0, 'unexpected decimals');

        const metadataInfo = svm.getAccount(await findMetadataPda(nftMintKeypair.address));
        assert(metadataInfo.exists, 'metadata account not created');
    });

    it('Mint some tokens to your wallet!', async () => {
        const associatedTokenAccountAddress = await findAssociatedTokenAddress(tokenMintKeypair.address, payer.address);

        const instructionData = borshSerialize(MintSplArgsSchema, {
            instruction: MyInstruction.MintSpl,
            quantity: BigInt(150),
        });

        const ix = {
            programAddress: programId,
            accounts: [
                { address: tokenMintKeypair.address, role: AccountRole.WRITABLE }, // Mint account
                { address: payer.address, role: AccountRole.WRITABLE }, // Mint authority account
                { address: associatedTokenAccountAddress, role: AccountRole.WRITABLE }, // ATA
                { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer }, // Payer
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY }, // System program
                { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY }, // Token program
                { address: ASSOCIATED_TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY }, // Associated token program
            ],
            data: new Uint8Array(instructionData),
        };

        await sendTransaction(ix);

        assert.equal(tokenBalance(associatedTokenAccountAddress), '150', 'unexpected token balance');

        const mintInfo = svm.getAccount(tokenMintKeypair.address);
        assert(mintInfo.exists, 'mint account not found');
        const mint = getMintDecoder().decode(mintInfo.data);
        assert.equal(mint.supply.toString(), '150', 'unexpected mint supply');
    });

    it('Mint the NFT to your wallet!', async () => {
        const editionAddress = await findEditionPda(nftMintKeypair.address);
        const associatedTokenAccountAddress = await findAssociatedTokenAddress(nftMintKeypair.address, payer.address);

        const instructionData = borshSerialize(MintNftArgsSchema, {
            instruction: MyInstruction.MintNft,
        });

        const ix = {
            programAddress: programId,
            accounts: [
                { address: nftMintKeypair.address, role: AccountRole.WRITABLE }, // Mint account
                { address: await findMetadataPda(nftMintKeypair.address), role: AccountRole.WRITABLE }, // Metadata account
                { address: editionAddress, role: AccountRole.WRITABLE }, // Edition account
                { address: payer.address, role: AccountRole.WRITABLE }, // Mint authority account
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

        assert.equal(tokenBalance(associatedTokenAccountAddress), '1', 'unexpected NFT balance');

        const editionInfo = svm.getAccount(editionAddress);
        assert(editionInfo.exists, 'edition account not created');
        assert(editionInfo.programAddress === TOKEN_METADATA_PROGRAM_ID, 'edition account has wrong owner');

        const mintInfo = svm.getAccount(nftMintKeypair.address);
        assert(mintInfo.exists, 'mint account not found');
        const mint = getMintDecoder().decode(mintInfo.data);
        assert(unwrapOption(mint.mintAuthority) === editionAddress, 'mint authority not transferred to the edition');
    });

    async function transferTokens(mint: Address, quantity: bigint) {
        const fromAssociatedTokenAddress = await findAssociatedTokenAddress(mint, payer.address);
        const toAssociatedTokenAddress = await findAssociatedTokenAddress(mint, recipientWallet.address);

        const instructionData = borshSerialize(TransferTokensArgsSchema, {
            instruction: MyInstruction.TransferTokens,
            quantity,
        });

        const ix = {
            programAddress: programId,
            accounts: [
                { address: mint, role: AccountRole.WRITABLE }, // Mint account
                { address: fromAssociatedTokenAddress, role: AccountRole.WRITABLE }, // Owner Token account
                { address: toAssociatedTokenAddress, role: AccountRole.WRITABLE }, // Recipient Token account
                { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer }, // Owner
                { address: recipientWallet.address, role: AccountRole.WRITABLE_SIGNER, signer: recipientWallet }, // Recipient
                { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer }, // Payer
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY }, // System program
                { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY }, // Token program
                { address: ASSOCIATED_TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY }, // Associated token program
            ],
            data: new Uint8Array(instructionData),
        };

        await sendTransaction(ix);
    }

    it('Transfer tokens to another wallet!', async () => {
        await transferTokens(tokenMintKeypair.address, BigInt(15));

        const fromAta = await findAssociatedTokenAddress(tokenMintKeypair.address, payer.address);
        const toAta = await findAssociatedTokenAddress(tokenMintKeypair.address, recipientWallet.address);
        assert.equal(tokenBalance(toAta), '15', 'unexpected recipient balance');
        assert.equal(tokenBalance(fromAta), '135', 'unexpected sender balance');
    });

    it('Transfer NFT to another wallet!', async () => {
        await transferTokens(nftMintKeypair.address, BigInt(1));

        const fromAta = await findAssociatedTokenAddress(nftMintKeypair.address, payer.address);
        const toAta = await findAssociatedTokenAddress(nftMintKeypair.address, recipientWallet.address);
        assert.equal(tokenBalance(toAta), '1', 'unexpected recipient NFT balance');
        assert.equal(tokenBalance(fromAta), '0', 'unexpected sender NFT balance');
    });
});
