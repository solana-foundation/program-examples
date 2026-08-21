import * as anchor from '@anchor-lang/core';
import { secp256k1 } from '@noble/curves/secp256k1';
import { keccak_256 } from '@noble/hashes/sha3.js';
import {
    createAssociatedTokenAccountInstruction,
    createInitializeMint2Instruction,
    createMintToInstruction,
    getAssociatedTokenAddressSync,
    MINT_SIZE,
    TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { getTokenDecoder } from '@solana-program/token';
import { LiteSVMProvider } from 'anchor-litesvm';
import { assert, expect } from 'chai';
import { LiteSVM } from 'litesvm';
import IDL from '../target/idl/external_delegate_token_master.json';
import type { ExternalDelegateTokenMaster } from '../target/types/external_delegate_token_master';

const PROGRAM_ID = new PublicKey(IDL.address);

// Must match `TRANSFER_DOMAIN` in lib.rs exactly.
const TRANSFER_DOMAIN = Buffer.from('external-delegate-token-master:transfer_tokens:v1', 'ascii');

const expectAnchorError = async (promise: Promise<unknown>, code: string) => {
    let caught: any;
    try {
        await promise;
    } catch (error) {
        caught = error;
    }
    assert.isDefined(caught, `expected the transaction to fail with ${code}`);
    assert.strictEqual(caught?.error?.errorCode?.code, code, `expected ${code}, got: ${caught}`);
};

// Derives an Ethereum address from a raw secp256k1 private key. Note this DOES slice off the
// leading byte: @noble/curves returns an uncompressed key prefixed with 0x04, unlike
// `solana_secp256k1_recover::Secp256k1Pubkey::to_bytes()` on the Rust side, which is already
// the bare 64-byte X||Y with no prefix. Conflating the two is exactly the bug this fix corrects.
const deriveEthAddress = (privateKey: Uint8Array): Uint8Array => {
    const uncompressed = secp256k1.getPublicKey(privateKey, false);
    return keccak_256(uncompressed.slice(1)).slice(-20);
};

// Byte-for-byte identical to `transfer_digest` in lib.rs.
const buildTransferDigest = (
    userAccountKey: PublicKey,
    userTokenAccountKey: PublicKey,
    recipientTokenAccountKey: PublicKey,
    amount: anchor.BN,
    nonce: anchor.BN,
): Uint8Array =>
    keccak_256(
        Buffer.concat([
            TRANSFER_DOMAIN,
            PROGRAM_ID.toBuffer(),
            userAccountKey.toBuffer(),
            userTokenAccountKey.toBuffer(),
            recipientTokenAccountKey.toBuffer(),
            amount.toArrayLike(Buffer, 'le', 8),
            nonce.toArrayLike(Buffer, 'le', 8),
        ]),
    );

const signDigest = (digest: Uint8Array, privateKey: Uint8Array): Buffer => {
    const sig = secp256k1.sign(digest, privateKey);
    const out = Buffer.alloc(65);
    Buffer.from(sig.toCompactRawBytes()).copy(out, 0);
    out[64] = sig.recovery;
    return out;
};

describe('External Delegate Token Master Tests', () => {
    const client = new LiteSVM();
    client.addProgramFromFile(PROGRAM_ID, 'target/deploy/external_delegate_token_master.so');
    const provider = new LiteSVMProvider(client);
    anchor.setProvider(provider);
    const wallet = provider.wallet as anchor.Wallet;
    const program = new anchor.Program<ExternalDelegateTokenMaster>(IDL, provider);

    const authority = Keypair.generate();
    const userAccount = Keypair.generate();
    const [userPda] = PublicKey.findProgramAddressSync([userAccount.publicKey.toBuffer()], program.programId);

    client.airdrop(authority.publicKey, BigInt(LAMPORTS_PER_SOL));

    it('should initialize user account', async () => {
        await program.methods
            .initialize()
            .accountsPartial({
                userAccount: userAccount.publicKey,
                authority: authority.publicKey,
                systemProgram: SystemProgram.programId,
            })
            .signers([authority, userAccount])
            .rpc();

        const account = await program.account.userAccount.fetch(userAccount.publicKey);
        expect(account.authority.toString()).to.equal(authority.publicKey.toString());
        expect(account.ethereumAddress).to.deep.equal(new Array(20).fill(0));
        expect(account.nonce.toString()).to.equal('0');
    });

    it('should set ethereum address', async () => {
        const ethereumAddress = Buffer.from('1C8cd0c38F8DE35d6056c7C7aBFa7e65D260E816', 'hex');

        await program.methods
            .setEthereumAddress(Array.from(ethereumAddress))
            .accountsPartial({
                userAccount: userAccount.publicKey,
                authority: authority.publicKey,
            })
            .signers([authority])
            .rpc();

        const account = await program.account.userAccount.fetch(userAccount.publicKey);
        expect(account.ethereumAddress).to.deep.equal(Array.from(ethereumAddress));
    });

    it('should perform authority transfer', async () => {
        const mintKeypair = Keypair.generate();
        const mint = mintKeypair.publicKey;
        const userTokenAccount = getAssociatedTokenAddressSync(mint, userPda, true);
        const recipient = Keypair.generate();
        const recipientTokenAccount = getAssociatedTokenAddressSync(mint, recipient.publicKey);

        const lamports = await provider.connection.getMinimumBalanceForRentExemption(MINT_SIZE);
        const setupTx = new Transaction().add(
            SystemProgram.createAccount({
                fromPubkey: wallet.publicKey,
                newAccountPubkey: mint,
                space: MINT_SIZE,
                lamports,
                programId: TOKEN_PROGRAM_ID,
            }),
            createInitializeMint2Instruction(mint, 6, authority.publicKey, null),
            createAssociatedTokenAccountInstruction(wallet.publicKey, userTokenAccount, userPda, mint),
            createAssociatedTokenAccountInstruction(wallet.publicKey, recipientTokenAccount, recipient.publicKey, mint),
            createMintToInstruction(mint, userTokenAccount, authority.publicKey, 1_000_000_000),
        );
        await provider.sendAndConfirm!(setupTx, [mintKeypair, authority]);

        await program.methods
            .authorityTransfer(new anchor.BN(250))
            .accountsPartial({
                userAccount: userAccount.publicKey,
                authority: authority.publicKey,
                userTokenAccount,
                recipientTokenAccount,
                userPda,
                tokenProgram: TOKEN_PROGRAM_ID,
            })
            .signers([authority])
            .rpc();

        const recipientBalance = getTokenDecoder().decode(client.getAccount(recipientTokenAccount)!.data).amount;
        expect(recipientBalance).to.equal(BigInt(250));

        const userBalance = getTokenDecoder().decode(client.getAccount(userTokenAccount)!.data).amount;
        expect(userBalance).to.equal(BigInt(1_000_000_000 - 250));
    });

    describe('transferTokens (Ethereum-signature-gated)', () => {
        const ethPrivateKey = secp256k1.utils.randomSecretKey();
        const otherEthPrivateKey = secp256k1.utils.randomSecretKey();
        let mint: PublicKey;
        let userTokenAccount: PublicKey;
        let recipientTokenAccount: PublicKey;
        let happyPathSignature: Buffer;
        let happyPathAmount: anchor.BN;

        before(async () => {
            await program.methods
                .setEthereumAddress(Array.from(deriveEthAddress(ethPrivateKey)))
                .accountsPartial({ userAccount: userAccount.publicKey, authority: authority.publicKey })
                .signers([authority])
                .rpc();

            const mintKeypair = Keypair.generate();
            mint = mintKeypair.publicKey;
            userTokenAccount = getAssociatedTokenAddressSync(mint, userPda, true);
            const recipient = Keypair.generate();
            recipientTokenAccount = getAssociatedTokenAddressSync(mint, recipient.publicKey);

            const lamports = await provider.connection.getMinimumBalanceForRentExemption(MINT_SIZE);
            const setupTx = new Transaction().add(
                SystemProgram.createAccount({
                    fromPubkey: wallet.publicKey,
                    newAccountPubkey: mint,
                    space: MINT_SIZE,
                    lamports,
                    programId: TOKEN_PROGRAM_ID,
                }),
                createInitializeMint2Instruction(mint, 6, authority.publicKey, null),
                createAssociatedTokenAccountInstruction(wallet.publicKey, userTokenAccount, userPda, mint),
                createAssociatedTokenAccountInstruction(
                    wallet.publicKey,
                    recipientTokenAccount,
                    recipient.publicKey,
                    mint,
                ),
                createMintToInstruction(mint, userTokenAccount, authority.publicKey, 1_000_000_000),
            );
            await provider.sendAndConfirm!(setupTx, [mintKeypair, authority]);
        });

        it('transfers tokens with a valid, correctly-bound ethereum signature', async () => {
            const { nonce } = await program.account.userAccount.fetch(userAccount.publicKey);
            const amount = new anchor.BN(300);
            const digest = buildTransferDigest(
                userAccount.publicKey,
                userTokenAccount,
                recipientTokenAccount,
                amount,
                nonce,
            );
            const signature = signDigest(digest, ethPrivateKey);

            await program.methods
                .transferTokens(amount, Array.from(signature))
                .accountsPartial({
                    userAccount: userAccount.publicKey,
                    authority: authority.publicKey,
                    userTokenAccount,
                    recipientTokenAccount,
                    userPda,
                    tokenProgram: TOKEN_PROGRAM_ID,
                })
                .signers([authority])
                .rpc();

            const recipientBalance = getTokenDecoder().decode(client.getAccount(recipientTokenAccount)!.data).amount;
            expect(recipientBalance).to.equal(BigInt(300));
            const senderBalance = getTokenDecoder().decode(client.getAccount(userTokenAccount)!.data).amount;
            expect(senderBalance).to.equal(BigInt(1_000_000_000 - 300));

            const account = await program.account.userAccount.fetch(userAccount.publicKey);
            expect(account.nonce.toString()).to.equal('1');

            // Kept for the replay test below — must be the exact bytes that were consumed here.
            happyPathSignature = signature;
            happyPathAmount = amount;
        });

        it('rejects the same signature replayed after the nonce has advanced', async () => {
            // Without this, the resubmitted transaction is byte-identical to the one already
            // processed in the happy-path test and gets rejected as a duplicate at the runtime
            // level (before program logic runs) rather than exercising the on-chain nonce check.
            client.expireBlockhash();

            await expectAnchorError(
                program.methods
                    .transferTokens(happyPathAmount, Array.from(happyPathSignature))
                    .accountsPartial({
                        userAccount: userAccount.publicKey,
                        authority: authority.publicKey,
                        userTokenAccount,
                        recipientTokenAccount,
                        userPda,
                        tokenProgram: TOKEN_PROGRAM_ID,
                    })
                    .signers([authority])
                    .rpc(),
                'InvalidSignature',
            );
        });

        it('rejects a valid signature submitted with a different amount', async () => {
            const { nonce } = await program.account.userAccount.fetch(userAccount.publicKey);
            const signedAmount = new anchor.BN(100);
            const digest = buildTransferDigest(
                userAccount.publicKey,
                userTokenAccount,
                recipientTokenAccount,
                signedAmount,
                nonce,
            );
            const signature = signDigest(digest, ethPrivateKey);
            const submittedAmount = new anchor.BN(999);

            await expectAnchorError(
                program.methods
                    .transferTokens(submittedAmount, Array.from(signature))
                    .accountsPartial({
                        userAccount: userAccount.publicKey,
                        authority: authority.publicKey,
                        userTokenAccount,
                        recipientTokenAccount,
                        userPda,
                        tokenProgram: TOKEN_PROGRAM_ID,
                    })
                    .signers([authority])
                    .rpc(),
                'InvalidSignature',
            );
        });

        it('rejects a correctly-bound digest signed by an unregistered ethereum key', async () => {
            const { nonce } = await program.account.userAccount.fetch(userAccount.publicKey);
            const amount = new anchor.BN(100);
            const digest = buildTransferDigest(
                userAccount.publicKey,
                userTokenAccount,
                recipientTokenAccount,
                amount,
                nonce,
            );
            const signature = signDigest(digest, otherEthPrivateKey);

            await expectAnchorError(
                program.methods
                    .transferTokens(amount, Array.from(signature))
                    .accountsPartial({
                        userAccount: userAccount.publicKey,
                        authority: authority.publicKey,
                        userTokenAccount,
                        recipientTokenAccount,
                        userPda,
                        tokenProgram: TOKEN_PROGRAM_ID,
                    })
                    .signers([authority])
                    .rpc(),
                'InvalidSignature',
            );
        });
    });
});
