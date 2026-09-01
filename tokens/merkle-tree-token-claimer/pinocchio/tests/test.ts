import * as path from 'node:path';
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
    unwrapOption,
} from '@solana/kit';
import { SYSTEM_PROGRAM_ADDRESS } from '@solana-program/system';
import {
    ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
    TOKEN_PROGRAM_ADDRESS,
    findAssociatedTokenPda,
    getMintDecoder,
    getTokenDecoder,
} from '@solana-program/token-2022';
import { assert } from 'chai';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';

import { MerkleTree, leafBytes } from './merkle';

const INITIALIZE_AIRDROP_DATA = 0;
const UPDATE_TREE = 1;
const CLAIM_AIRDROP = 2;

const DECIMALS = 6;
const AIRDROP_AMOUNT = 6_000n;
const CLAIM_AMOUNTS = [1_000n, 2_000n, 3_000n];

const PROGRAM_SO = path.join(process.cwd(), 'tests', 'fixtures', 'merkle_tree_token_claimer_pinocchio_program.so');
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

describe('Merkle Tree Token Claimer (Pinocchio)', () => {
    let svm: LiteSVM;
    let programId: Address;
    let authority: KeyPairSigner;
    let mint: KeyPairSigner;
    let airdropState: Address;
    let vault: Address;
    let claimers: KeyPairSigner[];
    let tree: MerkleTree;

    before(async () => {
        svm = new LiteSVM();
        // The program derives its PDAs from the id it is invoked with and never
        // asserts a hardcoded one, so a generated id keeps the test self-contained.
        programId = (await generateKeyPairSigner()).address;
        svm.addProgramFromFile(programId, PROGRAM_SO);

        authority = await generateKeyPairSigner();
        svm.airdrop(authority.address, lamports(10_000_000_000n));

        mint = await generateKeyPairSigner();

        // Three leaves, so the top level is odd and the tree exercises the
        // zero-hash padding the on-chain verifier assumes.
        claimers = [await generateKeyPairSigner(), await generateKeyPairSigner(), await generateKeyPairSigner()];
        for (const claimer of claimers) svm.airdrop(claimer.address, lamports(10_000_000_000n));

        tree = new MerkleTree(claimers.map((c, i) => leafBytes(addressEncoder.encode(c.address), CLAIM_AMOUNTS[i])));

        [airdropState] = await getProgramDerivedAddress({
            programAddress: programId,
            seeds: ['merkle_tree', addressEncoder.encode(mint.address)],
        });
        [vault] = await findAssociatedTokenPda({
            owner: airdropState,
            mint: mint.address,
            tokenProgram: TOKEN_PROGRAM_ADDRESS,
        });
    });

    async function tx(
        instructions: Parameters<typeof appendTransactionMessageInstruction>[0][],
        feePayer: KeyPairSigner = authority,
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

    function airdropStateData() {
        const acc = svm.getAccount(airdropState);
        if (!acc?.exists) throw new Error('airdrop state not found');
        const view = new DataView(acc.data.buffer, acc.data.byteOffset);
        return {
            merkleRoot: Buffer.from(acc.data.slice(0, 32)),
            airdropAmount: view.getBigUint64(96, true),
            amountClaimed: view.getBigUint64(104, true),
        };
    }

    async function receiptAddress(index: bigint): Promise<Address> {
        const [address] = await getProgramDerivedAddress({
            programAddress: programId,
            seeds: ['claim_receipt', addressEncoder.encode(airdropState), u64(index)],
        });
        return address;
    }

    async function claimIx(claimer: KeyPairSigner, index: number, amount: bigint, proof: Uint8Array) {
        const [claimerAta] = await findAssociatedTokenPda({
            owner: claimer.address,
            mint: mint.address,
            tokenProgram: TOKEN_PROGRAM_ADDRESS,
        });
        return {
            programAddress: programId,
            accounts: [
                { address: airdropState, role: AccountRole.WRITABLE },
                { address: mint.address, role: AccountRole.READONLY },
                { address: vault, role: AccountRole.WRITABLE },
                { address: await receiptAddress(BigInt(index)), role: AccountRole.WRITABLE },
                { address: claimerAta, role: AccountRole.WRITABLE },
                { address: claimer.address, role: AccountRole.WRITABLE_SIGNER, signer: claimer },
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
                { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
                { address: ASSOCIATED_TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ],
            data: concatBytes(Uint8Array.of(CLAIM_AIRDROP), u64(amount), u64(BigInt(index)), proof),
        };
    }

    it('Initializes the airdrop', async () => {
        // A throwaway root, replaced below — the real one is installed by
        // "Updates the Merkle root before any claim".
        const placeholderRoot = new Uint8Array(32).fill(7);
        const ix = {
            programAddress: programId,
            accounts: [
                { address: airdropState, role: AccountRole.WRITABLE },
                { address: mint.address, role: AccountRole.WRITABLE_SIGNER, signer: mint },
                { address: vault, role: AccountRole.WRITABLE },
                { address: authority.address, role: AccountRole.WRITABLE_SIGNER, signer: authority },
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
                { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
                { address: ASSOCIATED_TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ],
            data: concatBytes(Uint8Array.of(INITIALIZE_AIRDROP_DATA), placeholderRoot, u64(AIRDROP_AMOUNT)),
        };
        send(await tx([ix]), 'initialize airdrop');

        const state = airdropStateData();
        assert.equal(state.airdropAmount, AIRDROP_AMOUNT, 'the airdrop size was recorded');
        assert.equal(state.amountClaimed, 0n, 'nothing claimed yet');
        assert.deepEqual(Array.from(state.merkleRoot), Array.from(placeholderRoot), 'the root was recorded');

        assert.equal(tokenAmount(vault), AIRDROP_AMOUNT, 'the vault holds the whole supply');

        // The mint authority is dropped, so the supply is fixed.
        const mintAccount = svm.getAccount(mint.address);
        if (!mintAccount?.exists) throw new Error('mint not found');
        const mintState = getMintDecoder().decode(mintAccount.data);
        assert.equal(mintState.decimals, DECIMALS);
        assert.isNull(unwrapOption(mintState.mintAuthority), 'the mint authority was revoked');
    });

    it('Updates the Merkle root before any claim', async () => {
        const ix = {
            programAddress: programId,
            accounts: [
                { address: airdropState, role: AccountRole.WRITABLE },
                { address: mint.address, role: AccountRole.READONLY },
                { address: authority.address, role: AccountRole.READONLY_SIGNER, signer: authority },
            ],
            data: concatBytes(Uint8Array.of(UPDATE_TREE), tree.root),
        };
        send(await tx([ix]), 'update tree');

        assert.deepEqual(
            Array.from(airdropStateData().merkleRoot),
            Array.from(tree.root),
            'the real root is now installed',
        );
    });

    it('Rejects an update signed by someone other than the authority', async () => {
        const impostor = claimers[0];
        const ix = {
            programAddress: programId,
            accounts: [
                { address: airdropState, role: AccountRole.WRITABLE },
                { address: mint.address, role: AccountRole.READONLY },
                { address: impostor.address, role: AccountRole.READONLY_SIGNER, signer: impostor },
            ],
            data: concatBytes(Uint8Array.of(UPDATE_TREE), new Uint8Array(32)),
        };

        const result = svm.sendTransaction(await tx([ix], impostor));
        assert.instanceOf(result, FailedTransactionMetadata, 'expected the update to be refused');
        assert.include(
            (result as FailedTransactionMetadata).meta().logs().join('\n'),
            'custom program error: 0x8',
            'rejected with NotAuthority',
        );
    });

    it('Pays a valid claim', async () => {
        const claimer = claimers[0];
        const ix = await claimIx(claimer, 0, CLAIM_AMOUNTS[0], tree.proof(0));
        send(await tx([ix], claimer), 'claim 0');

        const [claimerAta] = await findAssociatedTokenPda({
            owner: claimer.address,
            mint: mint.address,
            tokenProgram: TOKEN_PROGRAM_ADDRESS,
        });
        assert.equal(tokenAmount(claimerAta), CLAIM_AMOUNTS[0], 'the claimer was paid');
        assert.equal(tokenAmount(vault), AIRDROP_AMOUNT - CLAIM_AMOUNTS[0], 'the vault was debited');
        assert.equal(airdropStateData().amountClaimed, CLAIM_AMOUNTS[0], 'the running total was updated');
    });

    it('Rejects a second claim at the same index', async () => {
        const claimer = claimers[0];
        svm.expireBlockhash();
        const ix = await claimIx(claimer, 0, CLAIM_AMOUNTS[0], tree.proof(0));

        const result = svm.sendTransaction(await tx([ix], claimer));
        assert.instanceOf(result, FailedTransactionMetadata, 'expected the repeat claim to be refused');
        assert.include(
            (result as FailedTransactionMetadata).meta().logs().join('\n'),
            'custom program error: 0x1',
            'rejected with AlreadyClaimed',
        );
        assert.equal(airdropStateData().amountClaimed, CLAIM_AMOUNTS[0], 'nothing further was paid');
    });

    it("Rejects a claim using someone else's proof", async () => {
        // The leaf is `claimer | amount`, so a proof is bound to one wallet.
        // Someone outside the snapshot replaying leaf 1's proof recomputes a
        // different root. Index 1 is still unclaimed here, so this really does
        // exercise the proof check rather than the receipt check.
        const outsider = await generateKeyPairSigner();
        svm.airdrop(outsider.address, lamports(10_000_000_000n));
        const ix = await claimIx(outsider, 1, CLAIM_AMOUNTS[1], tree.proof(1));

        const result = svm.sendTransaction(await tx([ix], outsider));
        assert.instanceOf(result, FailedTransactionMetadata, 'expected the stolen proof to be refused');
        assert.include(
            (result as FailedTransactionMetadata).meta().logs().join('\n'),
            'custom program error: 0x0',
            'rejected with InvalidProof',
        );
    });

    it('Rejects an index past the proof depth', async () => {
        // The proof only authenticates as many index bits as it has levels.
        // Without the trailing `index == 0` check, leaf 1's proof would also
        // open a receipt at index 1 + 2^depth — a second payout for one leaf.
        const claimer = claimers[1];
        const depth = tree.proof(1).length / 32;
        const aliasedIndex = 1 + 2 ** depth;

        const ix = await claimIx(claimer, aliasedIndex, CLAIM_AMOUNTS[1], tree.proof(1));
        const result = svm.sendTransaction(await tx([ix], claimer));
        assert.instanceOf(result, FailedTransactionMetadata, 'expected the aliased index to be refused');
        assert.include(
            (result as FailedTransactionMetadata).meta().logs().join('\n'),
            'custom program error: 0x0',
            'rejected with InvalidProof',
        );
    });

    it('Rejects updating the tree once claims have started', async () => {
        const ix = {
            programAddress: programId,
            accounts: [
                { address: airdropState, role: AccountRole.WRITABLE },
                { address: mint.address, role: AccountRole.READONLY },
                { address: authority.address, role: AccountRole.READONLY_SIGNER, signer: authority },
            ],
            data: concatBytes(Uint8Array.of(UPDATE_TREE), new Uint8Array(32).fill(9)),
        };

        const result = svm.sendTransaction(await tx([ix]));
        assert.instanceOf(result, FailedTransactionMetadata, 'expected the late update to be refused');
        assert.include(
            (result as FailedTransactionMetadata).meta().logs().join('\n'),
            'custom program error: 0x4',
            'rejected with ClaimsStarted',
        );
        assert.deepEqual(Array.from(airdropStateData().merkleRoot), Array.from(tree.root), 'the root is unchanged');
    });

    it('Pays a claim whose receipt address was pre-funded', async () => {
        // Receipt addresses are publicly derivable, so anyone can drop lamports
        // on one before the rightful claimant gets there. `CreateAccount`
        // refuses to create over an existing balance, so a bare create here
        // would let an attacker permanently block any index for a few lamports.
        const index = 1;
        const claimer = claimers[index];
        const receipt = await receiptAddress(BigInt(index));
        svm.setAccount({
            address: receipt,
            data: new Uint8Array(0),
            executable: false,
            lamports: lamports(1n),
            programAddress: SYSTEM_PROGRAM_ADDRESS,
            space: 0n,
        });

        const ix = await claimIx(claimer, index, CLAIM_AMOUNTS[index], tree.proof(index));
        send(await tx([ix], claimer), 'claim over a pre-funded receipt');

        const [claimerAta] = await findAssociatedTokenPda({
            owner: claimer.address,
            mint: mint.address,
            tokenProgram: TOKEN_PROGRAM_ADDRESS,
        });
        assert.equal(tokenAmount(claimerAta), CLAIM_AMOUNTS[index], 'the claim was still paid');

        const receiptAccount = svm.getAccount(receipt);
        if (!receiptAccount?.exists) throw new Error('receipt not found');
        assert.equal(receiptAccount.programAddress, programId, 'the receipt ended up owned by the program');
    });

    it('Pays the remaining claims', async () => {
        for (const index of [2]) {
            const claimer = claimers[index];
            const ix = await claimIx(claimer, index, CLAIM_AMOUNTS[index], tree.proof(index));
            send(await tx([ix], claimer), `claim ${index}`);

            const [claimerAta] = await findAssociatedTokenPda({
                owner: claimer.address,
                mint: mint.address,
                tokenProgram: TOKEN_PROGRAM_ADDRESS,
            });
            assert.equal(tokenAmount(claimerAta), CLAIM_AMOUNTS[index], `claimer ${index} was paid`);
        }

        assert.equal(tokenAmount(vault), 0n, 'the vault is drained');
        assert.equal(airdropStateData().amountClaimed, AIRDROP_AMOUNT, 'the whole airdrop was claimed');
    });
});
