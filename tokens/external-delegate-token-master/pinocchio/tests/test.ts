import * as path from 'node:path';
import { secp256k1 } from '@noble/curves/secp256k1';
import { keccak_256 } from '@noble/hashes/sha3.js';
import {
    AccountRole,
    type Address,
    type KeyPairSigner,
    appendTransactionMessageInstruction,
    appendTransactionMessageInstructions,
    createTransactionMessage,
    generateKeyPairSigner,
    getAddressEncoder,
    getProgramDerivedAddress,
    lamports,
    pipe,
    setTransactionMessageFeePayerSigner,
    signTransactionMessageWithSigners,
} from '@solana/kit';
import { SYSTEM_PROGRAM_ADDRESS, getCreateAccountInstruction } from '@solana-program/system';
import {
    ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
    TOKEN_PROGRAM_ADDRESS,
    findAssociatedTokenPda,
    getCreateAssociatedTokenInstruction,
    getInitializeMint2Instruction,
    getMintToInstruction,
    getTokenDecoder,
} from '@solana-program/token-2022';
import { assert } from 'chai';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';

const INITIALIZE = 0;
const SET_ETHEREUM_ADDRESS = 1;
const TRANSFER_TOKENS = 2;
const AUTHORITY_TRANSFER = 3;

// Must match `TRANSFER_DOMAIN` in the program exactly.
const TRANSFER_DOMAIN = new TextEncoder().encode('external-delegate-token-master:transfer_tokens:v1');

const MINT_SIZE = 82n;
const DECIMALS = 6;
const MINTED_AMOUNT = 1_000_000n;
const TRANSFER_AMOUNT = 250_000n;

const PROGRAM_SO = path.join(process.cwd(), 'tests', 'fixtures', 'external_delegate_token_master_pinocchio_program.so');
const addressEncoder = getAddressEncoder();

function u64(n: bigint): Uint8Array {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setBigUint64(0, n, true);
    return b;
}
function concatBytes(...parts: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let offset = 0;
    for (const p of parts) {
        out.set(p, offset);
        offset += p.length;
    }
    return out;
}

// @noble/curves returns an uncompressed key with a leading 0x04; the Solana
// syscall hands back the bare 64-byte X||Y. Slicing here and not on the Rust
// side is deliberate — conflating the two yields a different address.
function deriveEthAddress(privateKey: Uint8Array): Uint8Array {
    return keccak_256(secp256k1.getPublicKey(privateKey, false).slice(1)).slice(-20);
}

function signDigest(digest: Uint8Array, privateKey: Uint8Array): Uint8Array {
    const sig = secp256k1.sign(digest, privateKey);
    return concatBytes(sig.toCompactRawBytes(), Uint8Array.of(sig.recovery));
}

describe('External Delegate Token Master (Pinocchio)', () => {
    let svm: LiteSVM;
    let programId: Address;
    let payer: KeyPairSigner;
    let userAccount: KeyPairSigner;
    let userPda: Address;
    let mint: KeyPairSigner;
    let userTokenAccount: Address;
    let recipientTokenAccount: Address;
    let recipient: KeyPairSigner;
    let ethPrivateKey: Uint8Array;
    let ethAddress: Uint8Array;

    before(async () => {
        svm = new LiteSVM();
        // The program derives its PDA from the id it is invoked with and never
        // asserts a hardcoded one, so a generated id keeps the test self-contained.
        programId = (await generateKeyPairSigner()).address;
        svm.addProgramFromFile(programId, PROGRAM_SO);

        payer = await generateKeyPairSigner();
        svm.airdrop(payer.address, lamports(10_000_000_000n));

        userAccount = await generateKeyPairSigner();
        recipient = await generateKeyPairSigner();
        mint = await generateKeyPairSigner();

        ethPrivateKey = secp256k1.utils.randomPrivateKey();
        ethAddress = deriveEthAddress(ethPrivateKey);

        [userPda] = await getProgramDerivedAddress({
            programAddress: programId,
            seeds: [addressEncoder.encode(userAccount.address)],
        });
    });

    async function tx(
        instructions: Parameters<typeof appendTransactionMessageInstruction>[0][],
        feePayer: KeyPairSigner = payer,
    ) {
        return signTransactionMessageWithSigners(
            pipe(
                createTransactionMessage({ version: 0 }),
                m => setTransactionMessageFeePayerSigner(feePayer, m),
                m => svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
                m => appendTransactionMessageInstructions(instructions, m),
            ),
        );
    }

    function send(signedTx: Parameters<typeof svm.sendTransaction>[0], label: string) {
        const result = svm.sendTransaction(signedTx);
        if (result instanceof FailedTransactionMetadata) {
            throw new Error(`${label} failed: ${result.err()}`);
        }
        return result;
    }

    function tokenAmount(account: Address): bigint {
        const acc = svm.getAccount(account);
        if (!acc?.exists) throw new Error('token account not found');
        return getTokenDecoder().decode(acc.data).amount;
    }

    function userState() {
        const acc = svm.getAccount(userAccount.address);
        if (!acc?.exists) throw new Error('user account not found');
        return {
            authority: acc.data.slice(0, 32),
            ethereumAddress: acc.data.slice(32, 52),
            nonce: new DataView(acc.data.buffer, acc.data.byteOffset).getBigUint64(52, true),
        };
    }

    // Byte-for-byte identical to the digest the program builds.
    function transferDigest(amount: bigint, nonce: bigint): Uint8Array {
        return keccak_256(
            concatBytes(
                TRANSFER_DOMAIN,
                new Uint8Array(addressEncoder.encode(programId)),
                new Uint8Array(addressEncoder.encode(userAccount.address)),
                new Uint8Array(addressEncoder.encode(userTokenAccount)),
                new Uint8Array(addressEncoder.encode(recipientTokenAccount)),
                u64(amount),
                u64(nonce),
            ),
        );
    }

    function transferIx(amount: bigint, signature: Uint8Array) {
        return {
            programAddress: programId,
            accounts: [
                { address: userAccount.address, role: AccountRole.WRITABLE },
                { address: payer.address, role: AccountRole.READONLY_SIGNER, signer: payer },
                { address: userTokenAccount, role: AccountRole.WRITABLE },
                { address: recipientTokenAccount, role: AccountRole.WRITABLE },
                { address: userPda, role: AccountRole.READONLY },
                { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ],
            data: concatBytes(Uint8Array.of(TRANSFER_TOKENS), u64(amount), signature),
        };
    }

    it('Initializes a user account', async () => {
        const ix = {
            programAddress: programId,
            accounts: [
                { address: userAccount.address, role: AccountRole.WRITABLE_SIGNER, signer: userAccount },
                { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ],
            data: Uint8Array.of(INITIALIZE),
        };
        send(await tx([ix]), 'initialize');

        const state = userState();
        assert.deepEqual(Array.from(state.authority), Array.from(addressEncoder.encode(payer.address)));
        assert.deepEqual(Array.from(state.ethereumAddress), new Array(20).fill(0), 'no Ethereum address yet');
        assert.equal(state.nonce, 0n, 'nonce starts at zero');
    });

    it('Rejects setting the Ethereum address from a non-authority', async () => {
        const impostor = await generateKeyPairSigner();
        svm.airdrop(impostor.address, lamports(1_000_000_000n));
        const ix = {
            programAddress: programId,
            accounts: [
                { address: userAccount.address, role: AccountRole.WRITABLE },
                { address: impostor.address, role: AccountRole.READONLY_SIGNER, signer: impostor },
            ],
            data: concatBytes(Uint8Array.of(SET_ETHEREUM_ADDRESS), ethAddress),
        };

        const result = svm.sendTransaction(await tx([ix], impostor));
        assert.instanceOf(result, FailedTransactionMetadata, 'expected the impostor to be refused');
        assert.include(
            (result as FailedTransactionMetadata).meta().logs().join('\n'),
            'custom program error: 0x2',
            'rejected with NotAuthority',
        );
    });

    it('Sets the Ethereum address', async () => {
        const ix = {
            programAddress: programId,
            accounts: [
                { address: userAccount.address, role: AccountRole.WRITABLE },
                { address: payer.address, role: AccountRole.READONLY_SIGNER, signer: payer },
            ],
            data: concatBytes(Uint8Array.of(SET_ETHEREUM_ADDRESS), ethAddress),
        };
        send(await tx([ix]), 'set ethereum address');

        assert.deepEqual(Array.from(userState().ethereumAddress), Array.from(ethAddress), 'the address was recorded');
    });

    it('Creates the mint and funds the user PDA token account', async () => {
        [userTokenAccount] = await findAssociatedTokenPda({
            owner: userPda,
            mint: mint.address,
            tokenProgram: TOKEN_PROGRAM_ADDRESS,
        });
        [recipientTokenAccount] = await findAssociatedTokenPda({
            owner: recipient.address,
            mint: mint.address,
            tokenProgram: TOKEN_PROGRAM_ADDRESS,
        });

        send(
            await tx([
                getCreateAccountInstruction({
                    payer,
                    newAccount: mint,
                    lamports: lamports(svm.minimumBalanceForRentExemption(MINT_SIZE)),
                    space: MINT_SIZE,
                    programAddress: TOKEN_PROGRAM_ADDRESS,
                }),
                getInitializeMint2Instruction(
                    { mint: mint.address, decimals: DECIMALS, mintAuthority: payer.address, freezeAuthority: null },
                    { programAddress: TOKEN_PROGRAM_ADDRESS },
                ),
                getCreateAssociatedTokenInstruction({
                    payer,
                    ata: userTokenAccount,
                    owner: userPda,
                    mint: mint.address,
                    tokenProgram: TOKEN_PROGRAM_ADDRESS,
                }),
                getCreateAssociatedTokenInstruction({
                    payer,
                    ata: recipientTokenAccount,
                    owner: recipient.address,
                    mint: mint.address,
                    tokenProgram: TOKEN_PROGRAM_ADDRESS,
                }),
                getMintToInstruction(
                    { mint: mint.address, token: userTokenAccount, mintAuthority: payer, amount: MINTED_AMOUNT },
                    { programAddress: TOKEN_PROGRAM_ADDRESS },
                ),
            ]),
            'create mint and token accounts',
        );

        assert.equal(tokenAmount(userTokenAccount), MINTED_AMOUNT, 'the user PDA holds the tokens');
    });

    it('Transfers on a valid Ethereum signature', async () => {
        const signature = signDigest(transferDigest(TRANSFER_AMOUNT, 0n), ethPrivateKey);
        send(await tx([transferIx(TRANSFER_AMOUNT, signature)]), 'transfer tokens');

        assert.equal(tokenAmount(recipientTokenAccount), TRANSFER_AMOUNT, 'the recipient was paid');
        assert.equal(tokenAmount(userTokenAccount), MINTED_AMOUNT - TRANSFER_AMOUNT, 'the user account was debited');
        assert.equal(userState().nonce, 1n, 'the nonce was consumed');
    });

    it('Rejects a replayed signature', async () => {
        // The digest commits to the nonce, which the previous transfer burned,
        // so the same signature no longer verifies.
        const signature = signDigest(transferDigest(TRANSFER_AMOUNT, 0n), ethPrivateKey);
        svm.expireBlockhash();

        const result = svm.sendTransaction(await tx([transferIx(TRANSFER_AMOUNT, signature)]));
        assert.instanceOf(result, FailedTransactionMetadata, 'expected the replay to be refused');
        assert.include(
            (result as FailedTransactionMetadata).meta().logs().join('\n'),
            'custom program error: 0x0',
            'rejected with InvalidSignature',
        );
        assert.equal(tokenAmount(recipientTokenAccount), TRANSFER_AMOUNT, 'nothing further moved');
    });

    it('Rejects a signature for a different amount', async () => {
        // The digest commits to the amount, so a signature authorising a small
        // transfer cannot be re-presented for a larger one.
        const signature = signDigest(transferDigest(1n, 1n), ethPrivateKey);

        const result = svm.sendTransaction(await tx([transferIx(TRANSFER_AMOUNT, signature)]));
        assert.instanceOf(result, FailedTransactionMetadata, 'expected the amount swap to be refused');
        assert.include(
            (result as FailedTransactionMetadata).meta().logs().join('\n'),
            'custom program error: 0x0',
            'rejected with InvalidSignature',
        );
    });

    it('Rejects a signature from the wrong key', async () => {
        const otherKey = secp256k1.utils.randomPrivateKey();
        const signature = signDigest(transferDigest(TRANSFER_AMOUNT, 1n), otherKey);

        const result = svm.sendTransaction(await tx([transferIx(TRANSFER_AMOUNT, signature)]));
        assert.instanceOf(result, FailedTransactionMetadata, 'expected the wrong signer to be refused');
        assert.include(
            (result as FailedTransactionMetadata).meta().logs().join('\n'),
            'custom program error: 0x0',
            'rejected with InvalidSignature',
        );
    });

    it('Lets the Solana authority move tokens without an Ethereum signature', async () => {
        // The escape hatch: losing the Ethereum key must not strand the balance.
        const before = tokenAmount(recipientTokenAccount);
        const ix = {
            programAddress: programId,
            accounts: [
                { address: userAccount.address, role: AccountRole.READONLY },
                { address: payer.address, role: AccountRole.READONLY_SIGNER, signer: payer },
                { address: userTokenAccount, role: AccountRole.WRITABLE },
                { address: recipientTokenAccount, role: AccountRole.WRITABLE },
                { address: userPda, role: AccountRole.READONLY },
                { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ],
            data: concatBytes(Uint8Array.of(AUTHORITY_TRANSFER), u64(TRANSFER_AMOUNT)),
        };
        send(await tx([ix]), 'authority transfer');

        assert.equal(tokenAmount(recipientTokenAccount), before + TRANSFER_AMOUNT, 'the recipient was paid');
        assert.equal(userState().nonce, 1n, 'no nonce was consumed');
    });

    it('Rejects a transfer before any Ethereum address is set', async () => {
        // A fresh account's address is all zeroes; without an explicit guard a
        // signature recovering to the zero address would be accepted.
        const freshUser = await generateKeyPairSigner();
        const initIx = {
            programAddress: programId,
            accounts: [
                { address: freshUser.address, role: AccountRole.WRITABLE_SIGNER, signer: freshUser },
                { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ],
            data: Uint8Array.of(INITIALIZE),
        };
        send(await tx([initIx]), 'initialize fresh user');

        const [freshPda] = await getProgramDerivedAddress({
            programAddress: programId,
            seeds: [addressEncoder.encode(freshUser.address)],
        });
        const ix = {
            programAddress: programId,
            accounts: [
                { address: freshUser.address, role: AccountRole.WRITABLE },
                { address: payer.address, role: AccountRole.READONLY_SIGNER, signer: payer },
                { address: userTokenAccount, role: AccountRole.WRITABLE },
                { address: recipientTokenAccount, role: AccountRole.WRITABLE },
                { address: freshPda, role: AccountRole.READONLY },
                { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ],
            data: concatBytes(Uint8Array.of(TRANSFER_TOKENS), u64(1n), new Uint8Array(65)),
        };

        const result = svm.sendTransaction(await tx([ix]));
        assert.instanceOf(result, FailedTransactionMetadata, 'expected the unset address to be refused');
        assert.include(
            (result as FailedTransactionMetadata).meta().logs().join('\n'),
            'custom program error: 0x5',
            'rejected with EthereumAddressUnset',
        );
    });
});
