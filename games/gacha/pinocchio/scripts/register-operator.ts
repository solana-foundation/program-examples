/**
 * Registers (and freezes) the gacha reveal operator in Collector Crypt's cc-vrf
 * authority registry, so that `settle_pull` reveals will pass the on-chain
 * validity-proof check.
 *
 * The operator is a throwaway Ed25519 keypair whose 32-byte seed is BOTH its
 * Solana signing key and its ECVRF key — `pk = publicKeyFromSeed(seed)` equals
 * the keypair's public key. It is generated on first run, saved to
 * `keys/operator-keypair.json` (gitignored), and funded from the payer.
 *
 * Idempotent: skips work if the authority is already registered and frozen.
 *
 * The two cc-vrf CPIs (`init_authority`, `freeze_authority`) are hand-built as
 * @solana/kit instructions: the Anchor discriminator + borsh args come from the
 * cc-vrf IDL, and the Light validity-proof passthrough accounts are resolved
 * with `@lightprotocol/stateless.js` exactly as the reveal path does.
 *
 * Env:
 *   RPC_URL        Photon-capable devnet RPC (required for compressed reads /
 *                  validity proofs). Falls back to VITE_DEVNET_RPC_URL loaded
 *                  from webapp/.env.local.
 *   PAYER_KEYPAIR  path to the funding keypair (default ~/.config/solana/id.json)
 *   LABEL          cc-vrf authority label (default "gacha-demo")
 *   FUND_SOL       operator top-up amount when under-funded (default 0.5)
 *
 * Run: `RPC_URL=… pnpm exec tsx scripts/register-operator.ts`
 */

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';

import {
    batchAddressTree,
    bn,
    createRpc,
    deriveAddressSeedV2,
    featureFlags,
    getBatchAddressTreeInfo,
    hashvToBn254FieldSizeBeU8Array,
    PackedAccounts,
    selectStateTreeInfo,
    SystemAccountMetaConfig,
    VERSION,
} from '@lightprotocol/stateless.js';
import { publicKeyFromSeed } from '@solana/gacha';
import {
    AccountRole,
    type Address,
    address,
    createClient,
    createKeyPairSignerFromBytes,
    getAddressDecoder,
    getAddressEncoder,
    getU8Encoder,
    getU16Encoder,
    getU32Encoder,
    getU64Encoder,
    type Instruction,
    type KeyPairSigner,
} from '@solana/kit';
import { solanaRpc } from '@solana/kit-plugin-rpc';
import { signer } from '@solana/kit-plugin-signer';

import { loadWebappEnv } from './load-webapp-env.js';

loadWebappEnv();

const RPC_URL = process.env.RPC_URL ?? process.env.VITE_DEVNET_RPC_URL;
if (!RPC_URL) {
    throw new Error('Set RPC_URL or VITE_DEVNET_RPC_URL in webapp/.env.local to a Photon-capable endpoint');
}
const rpcUrl = RPC_URL;

const OPERATOR_KEYPAIR_PATH = resolve(process.cwd(), 'keys/operator-keypair.json');
const FUND_SOL = Number(process.env.FUND_SOL ?? '0.5');
const MIN_OPERATOR_SOL = 0.3;
const LAMPORTS_PER_SOL = 1_000_000_000;

const CC_VRF_PROGRAM_ADDRESS = address('ccvrfu3fSpbnPLiUqdWAt85Zn9nq96ekwGTbHqGtdgQ');
const CC_VRF_PROGRAM_ID = addressToBytes(CC_VRF_PROGRAM_ADDRESS);
const CC_VRF_PROGRAM_PUBKEY = toLightPubkey(CC_VRF_PROGRAM_ADDRESS);
const SYSTEM_PROGRAM_ADDRESS = address('11111111111111111111111111111111');
const ADDRESS_TREE_V2 = addressToBytes(address(batchAddressTree));
const AUTHORITY_SEED = new TextEncoder().encode('vrf_authority');

/** RFC 9381 §7.5 IANA suite identifier (ECVRF-EDWARDS25519-SHA512-TAI). */
const SUITE_EDWARDS25519_SHA512_TAI = 0x03;

/** `sha256("global:init_authority")[0..8]`, from the cc-vrf IDL. */
const INIT_AUTHORITY_DISCRIMINATOR = Uint8Array.from([136, 150, 94, 172, 74, 199, 236, 85]);
/** `sha256("global:freeze_authority")[0..8]`, from the cc-vrf IDL. */
const FREEZE_AUTHORITY_DISCRIMINATOR = Uint8Array.from([59, 124, 222, 89, 27, 146, 178, 7]);
/** System program instruction index for `Transfer`. */
const SYSTEM_TRANSFER_INSTRUCTION = 2;

const u8 = (value: number): Uint8Array => Uint8Array.from(getU8Encoder().encode(value));
const u16 = (value: number): Uint8Array => Uint8Array.from(getU16Encoder().encode(value));
const u32 = (value: number): Uint8Array => Uint8Array.from(getU32Encoder().encode(value));
const u64 = (value: bigint): Uint8Array => Uint8Array.from(getU64Encoder().encode(value));

function concatBytes(...parts: Uint8Array[]): Uint8Array {
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
        out.set(part, offset);
        offset += part.length;
    }
    return out;
}

function forceLightV2(): void {
    (featureFlags as { version: unknown }).version = VERSION.V2;
}

function addressToBytes(value: Address): Uint8Array {
    return Uint8Array.from(getAddressEncoder().encode(value));
}

/** The web3.js `PublicKey` that Light's account builders accept, typed without importing web3.js. */
type LightPubkey = Parameters<typeof SystemAccountMetaConfig.new>[0];

/**
 * Present a kit `Address` as the program key Light's account builders expect.
 * They call exactly two methods on it: `toBuffer()`, to derive the Light
 * `cpi_authority` PDA, and `toBase58()`, when the built metas are read back.
 */
function toLightPubkey(value: Address): LightPubkey {
    const bytes = addressToBytes(value);
    return {
        toBase58: () => value,
        toBuffer: () => Buffer.from(bytes),
    } as unknown as LightPubkey;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
    return a.length === b.length && a.every((x, i) => x === b[i]);
}

function encodeLabel(label: string): Uint8Array {
    const bytes = new TextEncoder().encode(label);
    if (bytes.length > 32) throw new Error(`label "${label}" exceeds 32 bytes encoded`);
    const padded = new Uint8Array(32);
    padded.set(bytes, 0);
    return padded;
}

/** Borsh `ValidityProof` = `Option<CompressedProof>`; Some = 1 byte tag + a(32)+b(64)+c(32). */
function encodeValidityProof(
    compressedProof: { a: ArrayLike<number>; b: ArrayLike<number>; c: ArrayLike<number> } | null,
): Uint8Array {
    if (!compressedProof) return Uint8Array.of(0);
    return concatBytes(
        Uint8Array.of(1),
        Uint8Array.from(compressedProof.a),
        Uint8Array.from(compressedProof.b),
        Uint8Array.from(compressedProof.c),
    );
}

function toKitMeta(meta: { isSigner: boolean; isWritable: boolean; pubkey: { toBase58(): string } }): {
    address: Address;
    role: AccountRole;
} {
    const role = meta.isSigner
        ? meta.isWritable
            ? AccountRole.WRITABLE_SIGNER
            : AccountRole.READONLY_SIGNER
        : meta.isWritable
          ? AccountRole.WRITABLE
          : AccountRole.READONLY;
    return { address: address(meta.pubkey.toBase58()), role };
}

function loadKeypairBytes(path: string): Uint8Array {
    return Uint8Array.from(JSON.parse(readFileSync(path, 'utf-8')) as number[]);
}

/** Load the 64-byte operator secret key, generating (seed || publicKeyFromSeed(seed)) on first run. */
function loadOrCreateOperatorSecret(): Uint8Array {
    if (existsSync(OPERATOR_KEYPAIR_PATH)) {
        return loadKeypairBytes(OPERATOR_KEYPAIR_PATH);
    }
    const seed = new Uint8Array(randomBytes(32));
    const secretKey = concatBytes(seed, publicKeyFromSeed(seed));
    mkdirSync(dirname(OPERATOR_KEYPAIR_PATH), { recursive: true });
    writeFileSync(OPERATOR_KEYPAIR_PATH, JSON.stringify(Array.from(secretKey)));
    return secretKey;
}

/** V2 compressed address: `keccak256(seed || addressTree || programId)` reduced into BN254. */
function deriveAuthorityAddress(ownerBytes: Uint8Array, label: Uint8Array): Uint8Array {
    const seed = deriveAddressSeedV2([AUTHORITY_SEED, ownerBytes, label]);
    return hashvToBn254FieldSizeBeU8Array([seed, ADDRESS_TREE_V2, CC_VRF_PROGRAM_ID]);
}

type StatelessRpc = ReturnType<typeof createRpc>;

const vrfAuthorityFrozenOffset = 32 /* owner */ + 32 /* pk */ + 1; /* suite */

/**
 * Build the `init_authority` cc-vrf CPI instruction: a new-address validity
 * proof plus the packed Light passthrough accounts, mirroring the vrf-client's
 * `buildCreateContext` + `buildInitAuthorityIx`.
 */
async function buildInitAuthorityInstruction(
    rpc: StatelessRpc,
    operator: KeyPairSigner,
    authorityBytes: Uint8Array,
    pk: Uint8Array,
    label: Uint8Array,
): Promise<Instruction> {
    const addressTreeInfo = getBatchAddressTreeInfo();
    const proofRes = await rpc.getValidityProofV0(
        [],
        [{ address: bn(authorityBytes), queue: addressTreeInfo.queue, tree: addressTreeInfo.tree }],
    );
    const stateTreeInfo = selectStateTreeInfo(await rpc.getStateTreeInfos());

    const remaining = PackedAccounts.newWithSystemAccountsV2(SystemAccountMetaConfig.new(CC_VRF_PROGRAM_PUBKEY));
    const addressMtIndex = remaining.insertOrGet(addressTreeInfo.tree);
    const outputStateTreeIndex = remaining.insertOrGet(stateTreeInfo.queue);
    const remainingMetas = remaining.toAccountMetas().remainingAccounts;

    const rootIndex = proofRes.rootIndices[proofRes.rootIndices.length - 1];
    if (rootIndex === undefined) throw new Error('init_authority validity proof returned no address root index');

    const data = concatBytes(
        INIT_AUTHORITY_DISCRIMINATOR,
        encodeValidityProof(proofRes.compressedProof),
        u8(addressMtIndex), // PackedAddressTreeInfo.address_merkle_tree_pubkey_index
        u8(addressMtIndex), // PackedAddressTreeInfo.address_queue_pubkey_index
        u16(rootIndex), // PackedAddressTreeInfo.root_index
        u8(outputStateTreeIndex),
        pk,
        u8(SUITE_EDWARDS25519_SHA512_TAI),
        label,
    );

    return {
        accounts: [
            { address: operator.address, role: AccountRole.WRITABLE_SIGNER },
            { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ...remainingMetas.map(toKitMeta),
        ],
        data,
        programAddress: CC_VRF_PROGRAM_ADDRESS,
    };
}

/**
 * Build the `freeze_authority` cc-vrf CPI instruction: an existing-account
 * validity proof plus the packed Light passthrough accounts, mirroring the
 * vrf-client's `buildMutateContext` + `buildFreezeAuthorityIx`. `currentAuthority`
 * is the raw compressed-account data (already borsh `VrfAuthority`).
 */
async function buildFreezeAuthorityInstruction(
    rpc: StatelessRpc,
    operator: KeyPairSigner,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    account: any,
    currentAuthority: Uint8Array,
): Promise<Instruction> {
    const proofRes = await rpc.getValidityProofV0(
        [{ hash: account.hash, queue: account.treeInfo.queue, tree: account.treeInfo.tree }],
        [],
    );
    const stateTreeInfo = selectStateTreeInfo(await rpc.getStateTreeInfos());

    const remaining = PackedAccounts.newWithSystemAccountsV2(SystemAccountMetaConfig.new(CC_VRF_PROGRAM_PUBKEY));
    const merkleTreePubkeyIndex = remaining.insertOrGet(account.treeInfo.tree);
    const queuePubkeyIndex = remaining.insertOrGet(account.treeInfo.queue);
    const outputStateTreeIndex = remaining.insertOrGet(stateTreeInfo.queue);
    const remainingMetas = remaining.toAccountMetas().remainingAccounts;

    const rootIndex = proofRes.rootIndices[0];
    if (rootIndex === undefined) throw new Error('freeze_authority validity proof returned no root index');
    const proveByIndex = proofRes.proveByIndices[0] ? 1 : 0;

    const data = concatBytes(
        FREEZE_AUTHORITY_DISCRIMINATOR,
        encodeValidityProof(proofRes.compressedProof),
        currentAuthority, // VrfAuthority (raw compressed-account data)
        // CompressedAccountMeta { tree_info: PackedStateTreeInfo, address, output_state_tree_index }
        u16(rootIndex),
        u8(proveByIndex),
        u8(merkleTreePubkeyIndex),
        u8(queuePubkeyIndex),
        u32(account.leafIndex),
        Uint8Array.from(account.address),
        u8(outputStateTreeIndex),
    );

    return {
        accounts: [{ address: operator.address, role: AccountRole.WRITABLE_SIGNER }, ...remainingMetas.map(toKitMeta)],
        data,
        programAddress: CC_VRF_PROGRAM_ADDRESS,
    };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAuthorityAccount(rpc: StatelessRpc, authorityBytes: Uint8Array): Promise<any> {
    const account = await rpc.getCompressedAccount(bn(authorityBytes));
    if (!account?.data) return null;
    return account;
}

async function main(): Promise<void> {
    const payerPath = process.env.PAYER_KEYPAIR ?? `${homedir()}/.config/solana/id.json`;
    const payerSigner = await createKeyPairSignerFromBytes(loadKeypairBytes(payerPath));

    const operatorSecret = loadOrCreateOperatorSecret();
    const operatorSigner = await createKeyPairSignerFromBytes(operatorSecret);

    const seed = operatorSecret.slice(0, 32);
    const pk = publicKeyFromSeed(seed);
    if (!bytesEqual(pk, addressToBytes(operatorSigner.address))) {
        throw new Error('operator public key does not match its ECVRF public key');
    }

    const labelText = process.env.LABEL ?? 'gacha-demo';
    const label = encodeLabel(labelText);

    const payerClient = createClient().use(signer(payerSigner)).use(solanaRpc({ rpcUrl }));
    const operatorClient = createClient().use(signer(operatorSigner)).use(solanaRpc({ rpcUrl }));

    const { value: balance } = await operatorClient.rpc.getBalance(operatorSigner.address).send();
    if (balance < BigInt(Math.round(MIN_OPERATOR_SOL * LAMPORTS_PER_SOL))) {
        const lamports = BigInt(Math.round(FUND_SOL * LAMPORTS_PER_SOL));
        const transferIx: Instruction = {
            accounts: [
                { address: payerSigner.address, role: AccountRole.WRITABLE_SIGNER },
                { address: operatorSigner.address, role: AccountRole.WRITABLE },
            ],
            data: concatBytes(u32(SYSTEM_TRANSFER_INSTRUCTION), u64(lamports)),
            programAddress: SYSTEM_PROGRAM_ADDRESS,
        };
        const { context } = await payerClient.sendTransaction([transferIx]);
        console.log(`  funded operator with ${FUND_SOL} SOL (${context.signature})`);
    }

    forceLightV2();
    const rpc = createRpc(rpcUrl, rpcUrl, rpcUrl);

    const authorityBytes = deriveAuthorityAddress(addressToBytes(operatorSigner.address), label);

    let account = await fetchAuthorityAccount(rpc, authorityBytes);
    if (!account) {
        const ix = await buildInitAuthorityInstruction(rpc, operatorSigner, authorityBytes, pk, label);
        const { context } = await operatorClient.sendTransaction([ix]);
        console.log(`  init_authority: ${context.signature}`);
        account = await fetchAuthorityAccount(rpc, authorityBytes);
    } else {
        console.log('  authority already registered');
    }

    if (!account) throw new Error('authority not found after init_authority');

    const authorityData = Uint8Array.from(account.data.data);
    let frozen = authorityData[vrfAuthorityFrozenOffset] === 1;

    if (!frozen) {
        const ix = await buildFreezeAuthorityInstruction(rpc, operatorSigner, account, authorityData);
        const { context } = await operatorClient.sendTransaction([ix]);
        console.log(`  freeze_authority: ${context.signature}`);
        account = await fetchAuthorityAccount(rpc, authorityBytes);
        if (!account) throw new Error('authority not found after freeze_authority');
        frozen = Uint8Array.from(account.data.data)[vrfAuthorityFrozenOffset] === 1;
    } else {
        console.log('  authority already frozen');
    }

    if (!frozen) throw new Error('authority is not frozen after freeze_authority');

    console.log('\n✓ Operator registered and frozen in cc-vrf');
    console.log(`  operator:          ${operatorSigner.address}`);
    console.log(`  authority address: ${getAddressDecoder().decode(authorityBytes)}`);
    console.log(`  label:             ${labelText}`);
    console.log(`  frozen:            ${frozen}`);
    console.log('\nCreate the pool with this operator:');
    console.log(`  OPERATOR_PUBKEY=${operatorSigner.address} pnpm exec tsx scripts/setup-pool.ts`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
