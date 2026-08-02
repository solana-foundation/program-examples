import anchor from '@anchor-lang/core';

const BN = anchor.BN;

import { getAccount, getAssociatedTokenAddressSync, getMint } from '@solana/spl-token';
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { makeKeypairs } from '@solana-developers/helpers';
import { LiteSVMProvider } from 'anchor-litesvm';
import { assert } from 'chai';
import { LiteSVM } from 'litesvm';
import type { MerkleTreeTokenClaimer } from '../target/types/merkle_tree_token_claimer';
import { leafBytes, MerkleTree } from './merkle.ts';

import IDL from '../target/idl/merkle_tree_token_claimer.json' with { type: 'json' };

const PROGRAM_ID = new PublicKey(IDL.address);
const CLAIM_AMOUNTS = [125n, 275n, 400n];

interface Claimant {
    wallet: Keypair;
    amount: bigint;
}

describe('Merkle tree token claimer', () => {
    let client: LiteSVM;
    let provider: LiteSVMProvider;
    let program: anchor.Program<MerkleTreeTokenClaimer>;

    let authority: Keypair;
    let mint: Keypair;
    let claimants: Claimant[];
    let order: number[];
    let tree: MerkleTree;
    let airdropState: PublicKey;
    let vault: PublicKey;
    let totalAirdropAmount: bigint;

    const buildTree = () =>
        new MerkleTree(order.map(i => leafBytes(claimants[i].wallet.publicKey.toBytes(), claimants[i].amount)));

    // Rebuilds the tree with the leaves in reverse order: same claimants,
    // different root, so update_tree has something real to store.
    const reverseTree = (): Buffer => {
        order.reverse();
        tree = buildTree();
        return tree.root;
    };

    const claimReceiptAddress = (index: number): PublicKey => {
        const indexLe = Buffer.alloc(8);
        indexLe.writeBigUInt64LE(BigInt(index));
        return PublicKey.findProgramAddressSync(
            [Buffer.from('claim_receipt'), airdropState.toBuffer(), indexLe],
            PROGRAM_ID,
        )[0];
    };

    const signerAta = (wallet: PublicKey): PublicKey => getAssociatedTokenAddressSync(mint.publicKey, wallet, false);

    // Returns the claimant's position in the current tree plus the proof for it.
    const proofFor = (claimantIndex: number): { index: number; proof: Buffer } => {
        const index = order.indexOf(claimantIndex);
        return { index, proof: tree.proof(index) };
    };

    const initializeAirdrop = () =>
        program.methods
            .initializeAirdropData(Array.from(tree.root), new BN(totalAirdropAmount.toString()))
            .accountsPartial({
                airdropState,
                mint: mint.publicKey,
                vault,
                authority: authority.publicKey,
            })
            .signers([authority, mint])
            .rpc();

    const updateTree = (newRoot: Buffer) =>
        program.methods
            .updateTree(Array.from(newRoot))
            .accountsPartial({
                airdropState,
                mint: mint.publicKey,
                authority: authority.publicKey,
            })
            .signers([authority])
            .rpc();

    const claimAs = (wallet: Keypair, amount: bigint, proof: Buffer, index: number) =>
        program.methods
            .claimAirdrop(new BN(amount.toString()), proof, new BN(index))
            .accountsPartial({
                airdropState,
                mint: mint.publicKey,
                vault,
                claimReceipt: claimReceiptAddress(index),
                signerAta: signerAta(wallet.publicKey),
                signer: wallet.publicKey,
            })
            .signers([wallet])
            .rpc();

    const claimSuccess = async (claimantIndex: number): Promise<number> => {
        const claimant = claimants[claimantIndex];
        const { index, proof } = proofFor(claimantIndex);
        await claimAs(claimant.wallet, claimant.amount, proof, index);
        return index;
    };

    const expectFailureWith = async (promise: Promise<unknown>, errorName: string) => {
        try {
            await promise;
        } catch (error) {
            assert.include(String(error), errorName, `expected transaction to fail with ${errorName}`);
            return;
        }
        assert.fail(`expected transaction to fail with ${errorName}`);
    };

    beforeEach(() => {
        client = new LiteSVM();
        client.addProgramFromFile(PROGRAM_ID, 'target/deploy/merkle_tree_token_claimer.so');
        provider = new LiteSVMProvider(client);
        program = new anchor.Program<MerkleTreeTokenClaimer>(IDL, provider);

        const [authorityKeypair, mintKeypair, ...claimantWallets] = makeKeypairs(5);
        authority = authorityKeypair;
        mint = mintKeypair;
        client.airdrop(authority.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

        claimants = claimantWallets.map((wallet, i) => {
            client.airdrop(wallet.publicKey, BigInt(LAMPORTS_PER_SOL));
            return { wallet, amount: CLAIM_AMOUNTS[i] };
        });
        totalAirdropAmount = claimants.reduce((sum, claimant) => sum + claimant.amount, 0n);

        order = claimants.map((_, i) => i);
        tree = buildTree();

        airdropState = PublicKey.findProgramAddressSync(
            [Buffer.from('merkle_tree'), mint.publicKey.toBuffer()],
            PROGRAM_ID,
        )[0];
        vault = getAssociatedTokenAddressSync(mint.publicKey, airdropState, true);
    });

    it('initializes the airdrop, locks the mint, and allows root updates before claims', async () => {
        await initializeAirdrop();

        const state = await program.account.airdropState.fetch(airdropState);
        assert.deepEqual(Uint8Array.from(state.merkleRoot), Uint8Array.from(tree.root));
        assert.strictEqual(BigInt(state.airdropAmount.toString()), totalAirdropAmount);
        assert.strictEqual(BigInt(state.amountClaimed.toString()), 0n);
        assert.isTrue(state.authority.equals(authority.publicKey));

        // The full supply is minted to the vault and the mint authority is revoked.
        const mintAccount = await getMint(provider.connection, mint.publicKey);
        assert.isNull(mintAccount.mintAuthority);
        assert.strictEqual(mintAccount.supply, totalAirdropAmount);
        const vaultAccount = await getAccount(provider.connection, vault);
        assert.strictEqual(vaultAccount.amount, totalAirdropAmount);

        const updatedRoot = reverseTree();
        await updateTree(updatedRoot);

        const updatedState = await program.account.airdropState.fetch(airdropState);
        assert.deepEqual(Uint8Array.from(updatedState.merkleRoot), Uint8Array.from(updatedRoot));
        assert.strictEqual(BigInt(updatedState.amountClaimed.toString()), 0n);
    });

    it('pays out claims against the updated root and records receipts', async () => {
        await initializeAirdrop();
        await updateTree(reverseTree());

        const firstIndex = await claimSuccess(0);
        const firstReceipt = await program.account.claimReceipt.fetch(claimReceiptAddress(firstIndex));
        const stateAfterFirst = await program.account.airdropState.fetch(airdropState);

        const firstAta = await getAccount(provider.connection, signerAta(claimants[0].wallet.publicKey));
        assert.strictEqual(firstAta.amount, claimants[0].amount);
        assert.isTrue(firstReceipt.claimer.equals(claimants[0].wallet.publicKey));
        assert.strictEqual(BigInt(firstReceipt.amount.toString()), claimants[0].amount);
        assert.strictEqual(BigInt(stateAfterFirst.amountClaimed.toString()), claimants[0].amount);

        // One user claiming must not invalidate the other users' proofs.
        const secondIndex = await claimSuccess(1);
        const secondReceipt = await program.account.claimReceipt.fetch(claimReceiptAddress(secondIndex));
        const stateAfterSecond = await program.account.airdropState.fetch(airdropState);

        const secondAta = await getAccount(provider.connection, signerAta(claimants[1].wallet.publicKey));
        assert.strictEqual(secondAta.amount, claimants[1].amount);
        assert.strictEqual(
            BigInt(stateAfterSecond.amountClaimed.toString()),
            claimants[0].amount + claimants[1].amount,
        );
        const vaultAccount = await getAccount(provider.connection, vault);
        assert.strictEqual(vaultAccount.amount, totalAirdropAmount - claimants[0].amount - claimants[1].amount);
        assert.strictEqual(BigInt(secondReceipt.index.toString()), BigInt(secondIndex));
        assert.strictEqual(BigInt(secondReceipt.amount.toString()), claimants[1].amount);
    });

    it('rejects duplicate claims and proofs presented by the wrong signer', async () => {
        await initializeAirdrop();

        const claimedIndex = await claimSuccess(0);
        const duplicate = proofFor(0);
        assert.strictEqual(duplicate.index, claimedIndex);

        // Same instruction bytes need a fresh blockhash to form a new transaction.
        client.expireBlockhash();
        await expectFailureWith(
            claimAs(claimants[0].wallet, claimants[0].amount, duplicate.proof, duplicate.index),
            'AlreadyClaimed',
        );

        // An attacker replaying someone else's proof recomputes a different leaf
        // (their own pubkey) and fails verification.
        const attacker = Keypair.generate();
        client.airdrop(attacker.publicKey, BigInt(LAMPORTS_PER_SOL));
        const victim = proofFor(2);
        await expectFailureWith(claimAs(attacker, claimants[2].amount, victim.proof, victim.index), 'InvalidProof');
    });

    it('rejects root updates after claims begin', async () => {
        await initializeAirdrop();
        await claimSuccess(0);

        await expectFailureWith(updateTree(tree.root), 'ClaimsStarted');
    });
});
