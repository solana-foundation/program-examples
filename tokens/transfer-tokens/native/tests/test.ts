import {
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
import { findAssociatedTokenPda, getMintDecoder, getTokenDecoder, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import { assert } from 'chai';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';
import {
    createCreateInstruction,
    createMintNftInstruction,
    createMintSplInstruction,
    createTransferTokensInstruction,
    TOKEN_METADATA_PROGRAM_ADDRESS,
} from '../ts';

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
        svm.addProgramFromFile(TOKEN_METADATA_PROGRAM_ADDRESS, 'tests/fixtures/token_metadata.so');

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
            programAddress: TOKEN_METADATA_PROGRAM_ADDRESS,
            seeds: ['metadata', addressEncoder.encode(TOKEN_METADATA_PROGRAM_ADDRESS), addressEncoder.encode(mint)],
        });
        return metadataAddress;
    }

    async function findEditionPda(mint: Address): Promise<Address> {
        const [editionAddress] = await getProgramDerivedAddress({
            programAddress: TOKEN_METADATA_PROGRAM_ADDRESS,
            seeds: [
                'metadata',
                addressEncoder.encode(TOKEN_METADATA_PROGRAM_ADDRESS),
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
        const ix = createCreateInstruction(
            mintKeypair,
            payer.address,
            await findMetadataPda(mintKeypair.address),
            payer,
            programId,
            title,
            symbol,
            uri,
            decimals,
        );

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
        assert(metadataInfo.programAddress === TOKEN_METADATA_PROGRAM_ADDRESS, 'metadata account has wrong owner');
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

        const ix = createMintSplInstruction(
            tokenMintKeypair.address,
            payer.address,
            associatedTokenAccountAddress,
            payer,
            programId,
            150n,
        );

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

        const ix = createMintNftInstruction(
            nftMintKeypair.address,
            await findMetadataPda(nftMintKeypair.address),
            editionAddress,
            payer.address,
            associatedTokenAccountAddress,
            payer,
            programId,
        );

        await sendTransaction(ix);

        assert.equal(tokenBalance(associatedTokenAccountAddress), '1', 'unexpected NFT balance');

        const editionInfo = svm.getAccount(editionAddress);
        assert(editionInfo.exists, 'edition account not created');
        assert(editionInfo.programAddress === TOKEN_METADATA_PROGRAM_ADDRESS, 'edition account has wrong owner');

        const mintInfo = svm.getAccount(nftMintKeypair.address);
        assert(mintInfo.exists, 'mint account not found');
        const mint = getMintDecoder().decode(mintInfo.data);
        assert(unwrapOption(mint.mintAuthority) === editionAddress, 'mint authority not transferred to the edition');
    });

    async function transferTokens(mint: Address, quantity: bigint) {
        const ix = createTransferTokensInstruction(
            mint,
            await findAssociatedTokenAddress(mint, payer.address),
            await findAssociatedTokenAddress(mint, recipientWallet.address),
            payer,
            recipientWallet,
            payer,
            programId,
            quantity,
        );

        await sendTransaction(ix);
    }

    it('Transfer tokens to another wallet!', async () => {
        await transferTokens(tokenMintKeypair.address, 15n);

        const fromAta = await findAssociatedTokenAddress(tokenMintKeypair.address, payer.address);
        const toAta = await findAssociatedTokenAddress(tokenMintKeypair.address, recipientWallet.address);
        assert.equal(tokenBalance(toAta), '15', 'unexpected recipient balance');
        assert.equal(tokenBalance(fromAta), '135', 'unexpected sender balance');
    });

    it('Transfer NFT to another wallet!', async () => {
        await transferTokens(nftMintKeypair.address, 1n);

        const fromAta = await findAssociatedTokenAddress(nftMintKeypair.address, payer.address);
        const toAta = await findAssociatedTokenAddress(nftMintKeypair.address, recipientWallet.address);
        assert.equal(tokenBalance(toAta), '1', 'unexpected recipient NFT balance');
        assert.equal(tokenBalance(fromAta), '0', 'unexpected sender NFT balance');
    });
});
