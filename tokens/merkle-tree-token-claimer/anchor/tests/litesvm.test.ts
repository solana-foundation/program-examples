import { SYSTEM_PROGRAM_ADDRESS } from '@solana-program/system';
import {
    ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
    findAssociatedTokenPda,
    getMintDecoder,
    getTokenDecoder,
    TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token';
import {
    AccountRole,
    addEncoderSizePrefix,
    address,
    type Address,
    appendTransactionMessageInstruction,
    createTransactionMessage,
    fixDecoderSize,
    fixEncoderSize,
    generateKeyPairSigner,
    getAddressDecoder,
    getAddressEncoder,
    getBytesDecoder,
    getBytesEncoder,
    getProgramDerivedAddress,
    getStructDecoder,
    getStructEncoder,
    getU32Encoder,
    getU64Decoder,
    getU64Encoder,
    getU8Decoder,
    type Instruction,
    type KeyPairSigner,
    lamports,
    pipe,
    setTransactionMessageFeePayerSigner,
    signTransactionMessageWithSigners,
    unwrapOption,
} from '@solana/kit';
import { assert } from 'chai';
import { FailedTransactionMetadata, LiteSVM, type TransactionMetadata } from 'litesvm';
import { leafBytes, MerkleTree, ZERO_HASH } from './merkle.ts';

import IDL from '../target/idl/merkle_tree_token_claimer.json' with { type: 'json' };

const PROGRAM_ID = address(IDL.address);
const LAMPORTS_PER_SOL = 1_000_000_000n;
const CLAIM_AMOUNTS = [125n, 275n, 400n];

const addressEncoder = getAddressEncoder();

// Anchor instruction data is the instruction's 8-byte discriminator from the
// IDL followed by its Borsh-serialized arguments, all expressible with kit's
// codecs. (Codama can generate this client code from the IDL for larger
// projects.)
const instructionDiscriminator = (name: string): Uint8Array => {
    const instruction = IDL.instructions.find(ix => ix.name === name);
    if (!instruction) {
        throw new Error(`instruction ${name} is not in the IDL`);
    }
    return new Uint8Array(instruction.discriminator);
};

const initializeArgsEncoder = getStructEncoder([
    ['discriminator', fixEncoderSize(getBytesEncoder(), 8)],
    ['merkleRoot', fixEncoderSize(getBytesEncoder(), 32)],
    ['amount', getU64Encoder()],
]);

const updateTreeArgsEncoder = getStructEncoder([
    ['discriminator', fixEncoderSize(getBytesEncoder(), 8)],
    ['newRoot', fixEncoderSize(getBytesEncoder(), 32)],
]);

// Borsh encodes the `hashes: Vec<u8>` argument as a u32 length prefix
// followed by the raw proof bytes.
const claimArgsEncoder = getStructEncoder([
    ['discriminator', fixEncoderSize(getBytesEncoder(), 8)],
    ['amount', getU64Encoder()],
    ['hashes', addEncoderSizePrefix(getBytesEncoder(), getU32Encoder())],
    ['index', getU64Encoder()],
]);

// On-chain accounts have the same shape: an 8-byte account discriminator,
// then the Borsh-serialized fields.
const airdropStateDecoder = getStructDecoder([
    ['discriminator', fixDecoderSize(getBytesDecoder(), 8)],
    ['merkleRoot', fixDecoderSize(getBytesDecoder(), 32)],
    ['authority', getAddressDecoder()],
    ['mint', getAddressDecoder()],
    ['airdropAmount', getU64Decoder()],
    ['amountClaimed', getU64Decoder()],
    ['bump', getU8Decoder()],
]);

const claimReceiptDecoder = getStructDecoder([
    ['discriminator', fixDecoderSize(getBytesDecoder(), 8)],
    ['airdropState', getAddressDecoder()],
    ['claimer', getAddressDecoder()],
    ['index', getU64Decoder()],
    ['amount', getU64Decoder()],
    ['bump', getU8Decoder()],
]);

type TransactionResult = TransactionMetadata | FailedTransactionMetadata;

interface Claimant {
    wallet: KeyPairSigner;
    amount: bigint;
}

describe('Merkle tree token claimer', () => {
    let svm: LiteSVM;

    let authority: KeyPairSigner;
    let mint: KeyPairSigner;
    let claimants: Claimant[];
    let order: number[];
    let tree: MerkleTree;
    let airdropState: Address;
    let vault: Address;
    let totalAirdropAmount: bigint;

    const buildTree = () =>
        new MerkleTree(
            order.map(i => leafBytes(addressEncoder.encode(claimants[i].wallet.address), claimants[i].amount)),
        );

    // Rebuilds the tree with the leaves in reverse order: same claimants,
    // different root, so update_tree has something real to store.
    const reverseTree = (): Buffer => {
        order.reverse();
        tree = buildTree();
        return tree.root;
    };

    const claimReceiptAddress = async (index: number): Promise<Address> => {
        const [receiptAddress] = await getProgramDerivedAddress({
            programAddress: PROGRAM_ID,
            seeds: ['claim_receipt', addressEncoder.encode(airdropState), getU64Encoder().encode(BigInt(index))],
        });
        return receiptAddress;
    };

    const signerAta = async (wallet: Address): Promise<Address> => {
        const [ata] = await findAssociatedTokenPda({
            mint: mint.address,
            owner: wallet,
            tokenProgram: TOKEN_PROGRAM_ADDRESS,
        });
        return ata;
    };

    // Returns the claimant's position in the current tree plus the proof for it.
    const proofFor = (claimantIndex: number): { index: number; proof: Buffer } => {
        const index = order.indexOf(claimantIndex);
        return { index, proof: tree.proof(index) };
    };

    const sendInstruction = async (instruction: Instruction, feePayer: KeyPairSigner): Promise<TransactionResult> => {
        const message = pipe(
            createTransactionMessage({ version: 0 }),
            m => setTransactionMessageFeePayerSigner(feePayer, m),
            m => svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
            m => appendTransactionMessageInstruction(instruction, m),
        );
        return svm.sendTransaction(await signTransactionMessageWithSigners(message));
    };

    const expectSuccess = (result: TransactionResult) => {
        if (result instanceof FailedTransactionMetadata) {
            assert.fail(`transaction failed: ${result.err()}\n${result.meta().logs().join('\n')}`);
        }
    };

    const expectFailureWith = (result: TransactionResult, errorName: string) => {
        assert(result instanceof FailedTransactionMetadata, `expected transaction to fail with ${errorName}`);
        assert.include(result.meta().logs().join('\n'), errorName, `expected transaction to fail with ${errorName}`);
    };

    const initializeAirdrop = async () => {
        const instruction = {
            programAddress: PROGRAM_ID,
            accounts: [
                { address: airdropState, role: AccountRole.WRITABLE },
                { address: mint.address, role: AccountRole.WRITABLE_SIGNER, signer: mint },
                { address: vault, role: AccountRole.WRITABLE },
                { address: authority.address, role: AccountRole.WRITABLE_SIGNER, signer: authority },
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
                { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
                { address: ASSOCIATED_TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ],
            data: initializeArgsEncoder.encode({
                discriminator: instructionDiscriminator('initialize_airdrop_data'),
                merkleRoot: tree.root,
                amount: totalAirdropAmount,
            }),
        };
        expectSuccess(await sendInstruction(instruction, authority));
    };

    const updateTree = (newRoot: Uint8Array): Promise<TransactionResult> => {
        const instruction = {
            programAddress: PROGRAM_ID,
            accounts: [
                { address: airdropState, role: AccountRole.WRITABLE },
                { address: mint.address, role: AccountRole.READONLY },
                { address: authority.address, role: AccountRole.READONLY_SIGNER, signer: authority },
            ],
            data: updateTreeArgsEncoder.encode({
                discriminator: instructionDiscriminator('update_tree'),
                newRoot,
            }),
        };
        return sendInstruction(instruction, authority);
    };

    const claimAs = async (
        wallet: KeyPairSigner,
        amount: bigint,
        proof: Uint8Array,
        index: number,
    ): Promise<TransactionResult> => {
        const instruction = {
            programAddress: PROGRAM_ID,
            accounts: [
                { address: airdropState, role: AccountRole.WRITABLE },
                { address: mint.address, role: AccountRole.READONLY },
                { address: vault, role: AccountRole.WRITABLE },
                { address: await claimReceiptAddress(index), role: AccountRole.WRITABLE },
                { address: await signerAta(wallet.address), role: AccountRole.WRITABLE },
                { address: wallet.address, role: AccountRole.WRITABLE_SIGNER, signer: wallet },
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
                { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
                { address: ASSOCIATED_TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ],
            data: claimArgsEncoder.encode({
                discriminator: instructionDiscriminator('claim_airdrop'),
                amount,
                hashes: proof,
                index: BigInt(index),
            }),
        };
        return sendInstruction(instruction, wallet);
    };

    const claimSuccess = async (claimantIndex: number): Promise<number> => {
        const claimant = claimants[claimantIndex];
        const { index, proof } = proofFor(claimantIndex);
        expectSuccess(await claimAs(claimant.wallet, claimant.amount, proof, index));
        return index;
    };

    const accountData = (accountAddress: Address): Uint8Array => {
        const account = svm.getAccount(accountAddress);
        assert(account.exists, `account ${accountAddress} does not exist`);
        return account.data;
    };

    const fetchAirdropState = () => airdropStateDecoder.decode(accountData(airdropState));
    const fetchClaimReceipt = async (index: number) =>
        claimReceiptDecoder.decode(accountData(await claimReceiptAddress(index)));
    const tokenBalance = (tokenAccount: Address): bigint => getTokenDecoder().decode(accountData(tokenAccount)).amount;

    beforeEach(async () => {
        svm = new LiteSVM();
        svm.addProgramFromFile(PROGRAM_ID, 'target/deploy/merkle_tree_token_claimer.so');

        const [authoritySigner, mintSigner, ...claimantWallets] = await Promise.all(
            Array.from({ length: 5 }, () => generateKeyPairSigner()),
        );
        authority = authoritySigner;
        mint = mintSigner;
        svm.airdrop(authority.address, lamports(10n * LAMPORTS_PER_SOL));

        claimants = claimantWallets.map((wallet, i) => {
            svm.airdrop(wallet.address, lamports(LAMPORTS_PER_SOL));
            return { wallet, amount: CLAIM_AMOUNTS[i] };
        });
        totalAirdropAmount = claimants.reduce((sum, claimant) => sum + claimant.amount, 0n);

        order = claimants.map((_, i) => i);
        tree = buildTree();

        [airdropState] = await getProgramDerivedAddress({
            programAddress: PROGRAM_ID,
            seeds: ['merkle_tree', addressEncoder.encode(mint.address)],
        });
        [vault] = await findAssociatedTokenPda({
            mint: mint.address,
            owner: airdropState,
            tokenProgram: TOKEN_PROGRAM_ADDRESS,
        });
    });

    it('initializes the airdrop, locks the mint, and allows root updates before claims', async () => {
        await initializeAirdrop();

        const state = fetchAirdropState();
        assert.deepEqual(Uint8Array.from(state.merkleRoot), Uint8Array.from(tree.root));
        assert.strictEqual(state.airdropAmount, totalAirdropAmount);
        assert.strictEqual(state.amountClaimed, 0n);
        assert.strictEqual(state.authority, authority.address);

        // The full supply is minted to the vault and the mint authority is revoked.
        const mintAccount = getMintDecoder().decode(accountData(mint.address));
        assert.isNull(unwrapOption(mintAccount.mintAuthority));
        assert.strictEqual(mintAccount.supply, totalAirdropAmount);
        assert.strictEqual(tokenBalance(vault), totalAirdropAmount);

        const updatedRoot = reverseTree();
        expectSuccess(await updateTree(updatedRoot));

        const updatedState = fetchAirdropState();
        assert.deepEqual(Uint8Array.from(updatedState.merkleRoot), Uint8Array.from(updatedRoot));
        assert.strictEqual(updatedState.amountClaimed, 0n);
    });

    it('pays out claims against the updated root and records receipts', async () => {
        await initializeAirdrop();
        expectSuccess(await updateTree(reverseTree()));

        const firstIndex = await claimSuccess(0);
        const firstReceipt = await fetchClaimReceipt(firstIndex);
        const stateAfterFirst = fetchAirdropState();

        assert.strictEqual(tokenBalance(await signerAta(claimants[0].wallet.address)), claimants[0].amount);
        assert.strictEqual(firstReceipt.claimer, claimants[0].wallet.address);
        assert.strictEqual(firstReceipt.amount, claimants[0].amount);
        assert.strictEqual(stateAfterFirst.amountClaimed, claimants[0].amount);

        // One user claiming must not invalidate the other users' proofs.
        const secondIndex = await claimSuccess(1);
        const secondReceipt = await fetchClaimReceipt(secondIndex);
        const stateAfterSecond = fetchAirdropState();

        assert.strictEqual(tokenBalance(await signerAta(claimants[1].wallet.address)), claimants[1].amount);
        assert.strictEqual(stateAfterSecond.amountClaimed, claimants[0].amount + claimants[1].amount);
        assert.strictEqual(tokenBalance(vault), totalAirdropAmount - claimants[0].amount - claimants[1].amount);
        assert.strictEqual(secondReceipt.index, BigInt(secondIndex));
        assert.strictEqual(secondReceipt.amount, claimants[1].amount);
    });

    it('rejects duplicate claims and proofs presented by the wrong signer', async () => {
        await initializeAirdrop();

        const claimedIndex = await claimSuccess(0);
        const duplicate = proofFor(0);
        assert.strictEqual(duplicate.index, claimedIndex);

        // Same instruction bytes need a fresh blockhash to form a new transaction.
        svm.expireBlockhash();
        expectFailureWith(
            await claimAs(claimants[0].wallet, claimants[0].amount, duplicate.proof, duplicate.index),
            'AlreadyClaimed',
        );

        // An attacker replaying someone else's proof recomputes a different leaf
        // (their own pubkey) and fails verification.
        const attacker = await generateKeyPairSigner();
        svm.airdrop(attacker.address, lamports(LAMPORTS_PER_SOL));
        const victim = proofFor(2);
        expectFailureWith(await claimAs(attacker, claimants[2].amount, victim.proof, victim.index), 'InvalidProof');
    });

    it('rejects a valid proof replayed under a different receipt index', async () => {
        await initializeAirdrop();

        // The tree has three leaves, so the last node of the leaf level is
        // paired with a zero hash. If it were duplicated instead (the classic
        // construction bug), the parent would be sha256(C || C) and this proof
        // would also verify at index 3, minting a second receipt for the same
        // leaf. Both replays must fail proof verification.
        const lastLeafIndex = claimants.length - 1;
        const claimant = claimants[order[lastLeafIndex]];
        const proof = tree.proof(lastLeafIndex);
        expectSuccess(await claimAs(claimant.wallet, claimant.amount, proof, lastLeafIndex));

        expectFailureWith(await claimAs(claimant.wallet, claimant.amount, proof, lastLeafIndex + 1), 'InvalidProof');

        // Index bits above the proof depth must also be rejected; otherwise the
        // same proof would open receipt PDAs at index, index + 4, index + 8, ...
        const depth = Math.ceil(Math.log2(claimants.length));
        expectFailureWith(
            await claimAs(claimant.wallet, claimant.amount, proof, lastLeafIndex + 2 ** depth),
            'InvalidProof',
        );
    });

    it('refuses to build an empty tree and pads odd levels with a zero hash', () => {
        assert.throws(() => new MerkleTree([]), 'cannot build a Merkle tree with no leaves');

        // Three leaves: the lone third node is paired with ZERO_HASH, and its
        // proof therefore carries that zero sibling.
        const proof = tree.proof(claimants.length - 1);
        assert.deepEqual(Uint8Array.from(proof.subarray(0, 32)), Uint8Array.from(ZERO_HASH));
    });

    it('rejects root updates after claims begin', async () => {
        await initializeAirdrop();
        await claimSuccess(0);

        expectFailureWith(await updateTree(tree.root), 'ClaimsStarted');
    });
});
