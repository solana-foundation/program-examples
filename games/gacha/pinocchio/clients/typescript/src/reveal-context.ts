/**
 * cc-vrf / Light reveal context for `settle_pull`.
 *
 * Resolves everything the gacha `settle_pull` instruction needs from Collector
 * Crypt's cc-vrf registry and Light Protocol that @solana/kit cannot express:
 * the operator's compressed VrfAuthority record, a Light validity proof binding
 * that authority and the new commit address, and the four tree accounts the
 * cc-vrf CPI passes through.
 *
 * Light V2 address derivation hashes its seeds with Keccak256 and truncates the
 * digest into the BN254 field, and the validity proof is a Photon
 * (ZK-compression) RPC call — neither has a kit-native equivalent — so this
 * module is the one place the reveal path depends on
 * `@lightprotocol/stateless.js`. It is deliberately excluded from the package
 * barrel and exposed only via the `@solana/gacha/reveal-context` sub-path so
 * browser bundles never pull it in.
 */

import {
    batchAddressTree,
    bn,
    createRpc,
    deriveAddressSeedV2,
    featureFlags,
    getBatchAddressTreeInfo,
    hashvToBn254FieldSizeBeU8Array,
    selectStateTreeInfo,
    VERSION,
} from '@lightprotocol/stateless.js';
import { sha256 } from '@noble/hashes/sha2.js';
import {
    type Address,
    address,
    fixDecoderSize,
    getAddressDecoder,
    getAddressEncoder,
    getBooleanDecoder,
    getBytesDecoder,
    getStructDecoder,
    getU8Decoder,
    getU64Decoder,
} from '@solana/kit';

import type { LightCommitContextArgs } from './generated/index.js';

function addressToBytes(value: Address): Uint8Array {
    return Uint8Array.from(getAddressEncoder().encode(value));
}

const CC_VRF_PROGRAM_ID = addressToBytes(address('ccvrfu3fSpbnPLiUqdWAt85Zn9nq96ekwGTbHqGtdgQ'));
const AUTHORITY_SEED = new TextEncoder().encode('vrf_authority');
const PROOF_COMMIT_WITH_BETA_SEED = new TextEncoder().encode('vrf_proof');
const ADDRESS_TREE_V2 = addressToBytes(address(batchAddressTree));
const VALIDITY_PROOF_LENGTH = 128;

const vrfAuthorityDecoder = getStructDecoder([
    ['owner', getAddressDecoder()],
    ['pk', fixDecoderSize(getBytesDecoder(), 32)],
    ['suite', getU8Decoder()],
    ['frozen', getBooleanDecoder()],
    ['revoked', getBooleanDecoder()],
    ['label', fixDecoderSize(getBytesDecoder(), 32)],
    ['createdSlot', getU64Decoder()],
]);

const vrfProofCommitWithBetaDecoder = getStructDecoder([
    ['authority', getAddressDecoder()],
    ['memoHash', fixDecoderSize(getBytesDecoder(), 32)],
    ['proofHash', fixDecoderSize(getBytesDecoder(), 32)],
    ['alphaHash', fixDecoderSize(getBytesDecoder(), 32)],
    ['betaLo', fixDecoderSize(getBytesDecoder(), 32)],
    ['betaHi', fixDecoderSize(getBytesDecoder(), 32)],
    ['committedSlot', getU64Decoder()],
]);

/** Everything `settle_pull` needs beyond the beta/proof the operator computes. */
export interface SettleContext {
    readonly addressTree: Address;
    /** Derived compressed address of the operator's VrfAuthority record. */
    readonly authorityAddress: Address;
    readonly authorityQueue: Address;
    readonly authorityStateTree: Address;
    readonly frozen: boolean;
    /** Encoded directly into `settlePullData.light`. */
    readonly light: LightCommitContextArgs;
    /** Selected output state-tree queue; retry with `authorityQueue` if it fails. */
    readonly outputQueue: Address;
    readonly revoked: boolean;
    readonly suite: number;
}

function forceLightV2(): void {
    (featureFlags as { version: unknown }).version = VERSION.V2;
}

/** V2 compressed address: `keccak256(seed || addressTree || programId)` reduced into BN254. */
function deriveCompressedAddress(seeds: Uint8Array[]): Uint8Array {
    const seed = deriveAddressSeedV2(seeds);
    return hashvToBn254FieldSizeBeU8Array([seed, ADDRESS_TREE_V2, CC_VRF_PROGRAM_ID]);
}

function deriveAuthorityAddress(ownerBytes: Uint8Array, label: Uint8Array): Uint8Array {
    return deriveCompressedAddress([AUTHORITY_SEED, ownerBytes, label]);
}

function deriveCommitWithBetaAddress(authorityBytes: Uint8Array, memoHash: Uint8Array): Uint8Array {
    return deriveCompressedAddress([PROOF_COMMIT_WITH_BETA_SEED, authorityBytes, memoHash]);
}

/**
 * Resolve the reveal context for a pending pull. Returns `null` when the
 * operator has no VrfAuthority record for `authorityLabel`. `pull` doubles as
 * the cc-vrf memo (its 32 address bytes), matching the on-chain settle path.
 */
export async function buildSettleContext(
    rpcUrl: string,
    params: { authorityLabel: Uint8Array; operator: Address; pull: Address },
): Promise<SettleContext | null> {
    forceLightV2();
    const rpc = createRpc(rpcUrl, rpcUrl, rpcUrl);

    const authorityBytes = deriveAuthorityAddress(addressToBytes(params.operator), params.authorityLabel);
    const account = await rpc.getCompressedAccount(bn(authorityBytes));
    if (!account?.data) return null;
    const authority = vrfAuthorityDecoder.decode(Uint8Array.from(account.data.data));

    const memoHash = sha256(addressToBytes(params.pull));
    const commitBytes = deriveCommitWithBetaAddress(authorityBytes, memoHash);

    const addressTreeInfo = getBatchAddressTreeInfo();
    const proof = await rpc.getValidityProofV0(
        [{ hash: account.hash, queue: account.treeInfo.queue, tree: account.treeInfo.tree }],
        [{ address: bn(commitBytes), queue: addressTreeInfo.queue, tree: addressTreeInfo.tree }],
    );
    const compressedProof = proof.compressedProof;
    if (!compressedProof) throw new Error('cc-vrf settle requires a Light validity proof');

    const validityProof = [...compressedProof.a, ...compressedProof.b, ...compressedProof.c];
    if (validityProof.length !== VALIDITY_PROOF_LENGTH) {
        throw new Error(`validity proof must be ${VALIDITY_PROOF_LENGTH} bytes, got ${validityProof.length}`);
    }

    const outputInfo = selectStateTreeInfo(await rpc.getStateTreeInfos());

    return {
        addressTree: address(batchAddressTree),
        authorityAddress: getAddressDecoder().decode(authorityBytes),
        authorityQueue: address(account.treeInfo.queue.toBase58()),
        authorityStateTree: address(account.treeInfo.tree.toBase58()),
        frozen: authority.frozen,
        light: {
            addressTreeRootIndex: proof.rootIndices[proof.rootIndices.length - 1],
            authorityAddress: Array.from(authorityBytes),
            authorityCreatedSlot: authority.createdSlot,
            authorityLeafIndex: account.leafIndex,
            authorityProveByIndex: proof.proveByIndices[0] ? 1 : 0,
            authorityRootIndex: proof.rootIndices[0],
            validityProof,
        },
        outputQueue: address(outputInfo.queue.toBase58()),
        revoked: authority.revoked,
        suite: authority.suite,
    };
}

/**
 * Read back the 64-byte beta anchored in cc-vrf's VrfProofCommitWithBeta record
 * for `(authorityAddress, pull)`. Returns `null` if no commit exists yet.
 */
export async function fetchCommitBeta(
    rpcUrl: string,
    params: { authorityAddress: Address; pull: Address },
): Promise<Uint8Array | null> {
    forceLightV2();
    const rpc = createRpc(rpcUrl, rpcUrl, rpcUrl);

    const memoHash = sha256(addressToBytes(params.pull));
    const commitBytes = deriveCommitWithBetaAddress(addressToBytes(params.authorityAddress), memoHash);
    const account = await rpc.getCompressedAccount(bn(commitBytes));
    if (!account?.data) return null;

    const commit = vrfProofCommitWithBetaDecoder.decode(Uint8Array.from(account.data.data));
    const beta = new Uint8Array(64);
    beta.set(commit.betaLo, 0);
    beta.set(commit.betaHi, 32);
    return beta;
}
