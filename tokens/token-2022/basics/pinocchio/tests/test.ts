import * as path from 'node:path';
import {
    AccountRole,
    type Address,
    appendTransactionMessageInstruction,
    createTransactionMessage,
    generateKeyPairSigner,
    getAddressEncoder,
    getProgramDerivedAddress,
    lamports,
    pipe,
    setTransactionMessageFeePayerSigner,
    signTransactionMessageWithSigners,
} from '@solana/kit';
import { SYSTEM_PROGRAM_ADDRESS } from '@solana-program/system';
import {
    ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
    findAssociatedTokenPda,
    getTokenDecoder,
    TOKEN_2022_PROGRAM_ADDRESS,
} from '@solana-program/token-2022';
import { assert } from 'chai';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';

const PROGRAM_SO = path.join(process.cwd(), 'tests', 'fixtures', 'token_2022_basics_pinocchio_program.so');

// Instruction discriminators, matching `processor.rs`.
const CREATE_TOKEN = 0;
const CREATE_TOKEN_ACCOUNT = 1;
const CREATE_ASSOCIATED_TOKEN_ACCOUNT = 2;
const TRANSFER_TOKEN = 3;
const MINT_TOKEN = 4;

const TOKEN_NAME = 'TestToken';
const DECIMALS = 6;
// A Token-2022 token account with no extensions is a plain 165-byte account.
const ACCOUNT_SIZE = 165;

const addressBytes = getAddressEncoder();
const encoder = new TextEncoder();

// Encodes a u64 amount as 8 little-endian bytes.
function u64le(n: bigint): Uint8Array {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setBigUint64(0, n, true);
    return b;
}

describe('Token-2022 Basics (Pinocchio)', () => {
    let svm: LiteSVM;
    let programId: Address;

    before(async () => {
        svm = new LiteSVM();
        programId = (await generateKeyPairSigner()).address;
        svm.addProgramFromFile(programId, PROGRAM_SO);
    });

    it('Creates a mint, an ATA, mints, transfers, and creates a PDA token account', async () => {
        const payer = await generateKeyPairSigner();
        svm.airdrop(payer.address, lamports(1_000_000_000n));

        // Builds, signs, and sends a one-instruction transaction, throwing on failure.
        const send = async (ix: Parameters<typeof appendTransactionMessageInstruction>[0]) => {
            const tx = pipe(
                createTransactionMessage({ version: 0 }),
                m => setTransactionMessageFeePayerSigner(payer, m),
                m => svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
                m => appendTransactionMessageInstruction(ix, m),
            );
            const result = svm.sendTransaction(await signTransactionMessageWithSigners(tx));
            if (result instanceof FailedTransactionMetadata) throw new Error(`Transaction failed: ${result.err()}`);
        };

        // Fetches an account that must exist, narrowing away the `exists: false` variant.
        const load = (addr: Address) => {
            const acc = svm.getAccount(addr);
            if (!acc?.exists) throw new Error(`Account not found: ${addr}`);
            return acc;
        };

        // The mint is the program's `[b"token-2022-token", payer, token_name]` PDA.
        const [mintPda] = await getProgramDerivedAddress({
            programAddress: programId,
            seeds: [encoder.encode('token-2022-token'), addressBytes.encode(payer.address), encoder.encode(TOKEN_NAME)],
        });

        // 1. Create the mint (6 decimals, payer as mint authority).
        const createTokenIx = {
            programAddress: programId,
            data: new Uint8Array([CREATE_TOKEN, ...encoder.encode(TOKEN_NAME)]),
            accounts: [
                { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
                { address: mintPda, role: AccountRole.WRITABLE },
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
                { address: TOKEN_2022_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ],
        };
        await send(createTokenIx);

        // 2. Create the payer's associated token account.
        const [payerAta] = await findAssociatedTokenPda({
            owner: payer.address,
            tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
            mint: mintPda,
        });
        const createAtaIx = {
            programAddress: programId,
            data: new Uint8Array([CREATE_ASSOCIATED_TOKEN_ACCOUNT]),
            accounts: [
                { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
                { address: mintPda, role: AccountRole.READONLY },
                { address: payerAta, role: AccountRole.WRITABLE },
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
                { address: TOKEN_2022_PROGRAM_ADDRESS, role: AccountRole.READONLY },
                { address: ASSOCIATED_TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ],
        };
        await send(createAtaIx);

        // 3. Mint 200,000,000 base units to the payer's ATA.
        const mintAmount = 200_000_000n;
        const mintIx = {
            programAddress: programId,
            data: new Uint8Array([MINT_TOKEN, ...u64le(mintAmount)]),
            accounts: [
                { address: payer.address, role: AccountRole.READONLY_SIGNER, signer: payer },
                { address: mintPda, role: AccountRole.WRITABLE },
                { address: payerAta, role: AccountRole.WRITABLE },
                { address: TOKEN_2022_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ],
        };
        await send(mintIx);

        let payerToken = getTokenDecoder().decode(load(payerAta).data);
        assert.equal(payerToken.mint, mintPda);
        assert.equal(payerToken.amount, mintAmount);

        // 4. Transfer 100 base units to a fresh receiver (creates the receiver's ATA).
        const receiver = await generateKeyPairSigner();
        const [receiverAta] = await findAssociatedTokenPda({
            owner: receiver.address,
            tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
            mint: mintPda,
        });
        const transferAmount = 100n;
        const transferIx = {
            programAddress: programId,
            data: new Uint8Array([TRANSFER_TOKEN, ...u64le(transferAmount)]),
            accounts: [
                { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
                { address: payerAta, role: AccountRole.WRITABLE },
                { address: receiver.address, role: AccountRole.READONLY },
                { address: receiverAta, role: AccountRole.WRITABLE },
                { address: mintPda, role: AccountRole.WRITABLE },
                { address: TOKEN_2022_PROGRAM_ADDRESS, role: AccountRole.READONLY },
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
                { address: ASSOCIATED_TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ],
        };
        await send(transferIx);

        const receiverToken = getTokenDecoder().decode(load(receiverAta).data);
        assert.equal(receiverToken.amount, transferAmount);
        payerToken = getTokenDecoder().decode(load(payerAta).data);
        assert.equal(payerToken.amount, mintAmount - transferAmount);

        // 5. Create the non-ATA PDA token account (the anchor example's reference path).
        const [tokenAccountPda] = await getProgramDerivedAddress({
            programAddress: programId,
            seeds: [
                encoder.encode('token-2022-token-account'),
                addressBytes.encode(payer.address),
                addressBytes.encode(mintPda),
            ],
        });
        const createTokenAccountIx = {
            programAddress: programId,
            data: new Uint8Array([CREATE_TOKEN_ACCOUNT]),
            accounts: [
                { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
                { address: mintPda, role: AccountRole.READONLY },
                { address: tokenAccountPda, role: AccountRole.WRITABLE },
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
                { address: TOKEN_2022_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ],
        };
        await send(createTokenAccountIx);

        const pdaAccount = load(tokenAccountPda);
        assert.equal(pdaAccount.programAddress, TOKEN_2022_PROGRAM_ADDRESS);
        assert.equal(pdaAccount.data.length, ACCOUNT_SIZE);
        const pdaToken = getTokenDecoder().decode(pdaAccount.data);
        assert.equal(pdaToken.mint, mintPda);
        assert.equal(pdaToken.owner, payer.address);

        console.log('Mint:', mintPda);
        console.log('Decimals:', DECIMALS);
    });

    it('Rejects a token name longer than the 32-byte PDA seed limit', async () => {
        const payer = await generateKeyPairSigner();
        svm.airdrop(payer.address, lamports(1_000_000_000n));

        // 33 bytes — one over the per-seed maximum. The client can't even derive
        // the PDA for such a seed, so pass a placeholder mint account: the
        // program's length guard rejects the instruction before it uses it.
        const longName = 'x'.repeat(33);
        const placeholderMint = (await generateKeyPairSigner()).address;

        const ix = {
            programAddress: programId,
            data: new Uint8Array([CREATE_TOKEN, ...encoder.encode(longName)]),
            accounts: [
                { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
                { address: placeholderMint, role: AccountRole.WRITABLE },
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
                { address: TOKEN_2022_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ],
        };
        const tx = pipe(
            createTransactionMessage({ version: 0 }),
            m => setTransactionMessageFeePayerSigner(payer, m),
            m => svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
            m => appendTransactionMessageInstruction(ix, m),
        );
        const result = svm.sendTransaction(await signTransactionMessageWithSigners(tx));
        assert.instanceOf(result, FailedTransactionMetadata, 'expected the oversized token name to be rejected');
    });
});
