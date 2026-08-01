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
 * Env:
 *   RPC_URL        Photon-capable devnet RPC (required for compressed reads /
 *                  validity proofs). Falls back to VITE_DEVNET_RPC_URL.
 *   PAYER_KEYPAIR  path to the funding keypair (default ~/.config/solana/id.json)
 *   LABEL          cc-vrf authority label (default "gacha-demo")
 *   FUND_SOL       operator top-up amount when under-funded (default 0.5)
 *
 * Run: `RPC_URL=… pnpm exec tsx scripts/register-operator.ts`
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';

import {
    encodeLabel,
    fetchAuthority,
    publicKeyFromSeed,
    SUITE_EDWARDS25519_SHA512_TAI,
} from '@collectorcrypt/vrf-client';
import { buildFreezeAuthorityIx, buildInitAuthorityIx, forceLightV2, getProgram } from '@collectorcrypt/vrf-client';
import * as anchor from '@coral-xyz/anchor';
import { createRpc } from '@lightprotocol/stateless.js';
import {
    ComputeBudgetProgram,
    Connection,
    Keypair,
    LAMPORTS_PER_SOL,
    PublicKey,
    sendAndConfirmTransaction,
    SystemProgram,
    Transaction,
} from '@solana/web3.js';

const RPC_URL = process.env.RPC_URL ?? process.env.VITE_DEVNET_RPC_URL ?? 'https://api.devnet.solana.com';
const OPERATOR_KEYPAIR_PATH = resolve(process.cwd(), 'keys/operator-keypair.json');
const FUND_SOL = Number(process.env.FUND_SOL ?? '0.5');
const MIN_OPERATOR_SOL = 0.3;

function loadKeypair(path: string): Keypair {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, 'utf-8')) as number[]));
}

function loadOrCreateOperator(): Keypair {
    if (existsSync(OPERATOR_KEYPAIR_PATH)) {
        return loadKeypair(OPERATOR_KEYPAIR_PATH);
    }
    const operator = Keypair.generate();
    mkdirSync(dirname(OPERATOR_KEYPAIR_PATH), { recursive: true });
    writeFileSync(OPERATOR_KEYPAIR_PATH, JSON.stringify(Array.from(operator.secretKey)));
    return operator;
}

async function fundOperator(connection: Connection, payer: Keypair, operator: PublicKey): Promise<void> {
    const balance = await connection.getBalance(operator);
    if (balance >= MIN_OPERATOR_SOL * LAMPORTS_PER_SOL) return;
    const tx = new Transaction().add(
        SystemProgram.transfer({
            fromPubkey: payer.publicKey,
            lamports: Math.round(FUND_SOL * LAMPORTS_PER_SOL),
            toPubkey: operator,
        }),
    );
    const sig = await sendAndConfirmTransaction(connection, tx, [payer], { commitment: 'confirmed' });
    console.log(`  funded operator with ${FUND_SOL} SOL (${sig})`);
}

async function main(): Promise<void> {
    const payerPath = process.env.PAYER_KEYPAIR ?? `${homedir()}/.config/solana/id.json`;
    const payer = loadKeypair(payerPath);
    const operator = loadOrCreateOperator();

    const seed = operator.secretKey.slice(0, 32);
    const pk = publicKeyFromSeed(seed);
    if (!operator.publicKey.equals(new PublicKey(pk))) {
        throw new Error('operator public key does not match its ECVRF public key');
    }

    const label = encodeLabel(process.env.LABEL ?? 'gacha-demo');

    const connection = new Connection(RPC_URL, 'confirmed');
    await fundOperator(connection, payer, operator.publicKey);

    const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(operator), { commitment: 'confirmed' });
    const program = getProgram(provider);
    const rpc = createRpc(RPC_URL, RPC_URL, RPC_URL);
    forceLightV2();

    const computeBudget = ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 });
    const send = (ix: anchor.web3.TransactionInstruction) =>
        sendAndConfirmTransaction(connection, new Transaction().add(computeBudget, ix), [operator], {
            commitment: 'confirmed',
        });

    let authority = await fetchAuthority(program, rpc, operator.publicKey, label);
    if (!authority) {
        const { ix } = await buildInitAuthorityIx(program, rpc, {
            label,
            owner: operator.publicKey,
            pk,
            suite: SUITE_EDWARDS25519_SHA512_TAI,
        });
        const sig = await send(ix);
        console.log(`  init_authority: ${sig}`);
        authority = await fetchAuthority(program, rpc, operator.publicKey, label);
    } else {
        console.log('  authority already registered');
    }

    if (!authority) throw new Error('authority not found after init_authority');

    if (!authority.decoded.frozen) {
        const ix = await buildFreezeAuthorityIx(program, rpc, { label, owner: operator.publicKey });
        const sig = await send(ix);
        console.log(`  freeze_authority: ${sig}`);
        authority = await fetchAuthority(program, rpc, operator.publicKey, label);
    } else {
        console.log('  authority already frozen');
    }

    if (!authority?.decoded.frozen) {
        throw new Error('authority is not frozen after freeze_authority');
    }

    console.log('\n✓ Operator registered and frozen in cc-vrf');
    console.log(`  operator:          ${operator.publicKey.toBase58()}`);
    console.log(`  authority address: ${authority.authorityAddress.toBase58()}`);
    console.log(`  label:             ${process.env.LABEL ?? 'gacha-demo'}`);
    console.log(`  frozen:            ${authority.decoded.frozen}`);
    console.log('\nCreate the pool with this operator:');
    console.log(`  OPERATOR_PUBKEY=${operator.publicKey.toBase58()} pnpm exec tsx scripts/setup-pool.ts`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
