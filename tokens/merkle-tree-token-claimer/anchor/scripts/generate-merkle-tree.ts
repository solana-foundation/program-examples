/**
 * Merkle tree generator for token claims.
 *
 * Reads a snapshot JSON file and produces:
 * 1. The Merkle root (stored on-chain by initialize_airdrop_data)
 * 2. An individual proof for each address (served to users by your claim UI)
 *
 * Usage: pnpm generate-tree <snapshot.json> <output.json>
 * Example: pnpm generate-tree scripts/sample-snapshot.json merkle-output.json
 */

import * as fs from 'node:fs';
import { address, type Address, getAddressEncoder } from '@solana/kit';
import { leafBytes, MerkleTree } from '../tests/merkle.ts';

interface SnapshotEntry {
    source_address: string;
    solana_address: string;
    amount: string | number;
}

interface Snapshot {
    snapshot_height: number;
    chain_id: string;
    timestamp: string;
    entries: SnapshotEntry[];
}

interface ProofEntry {
    solana_address: string;
    source_address: string;
    amount: string;
    index: number;
    proof: string;
}

const U64_MAX = 2n ** 64n - 1n;

function parseAmount(amount: string | number): bigint {
    if (typeof amount === 'number' && (!Number.isSafeInteger(amount) || amount < 0)) {
        throw new Error(`invalid numeric amount: ${amount}`);
    }
    if (typeof amount === 'string' && !/^\d+$/.test(amount)) {
        throw new Error(`invalid string amount: ${amount}`);
    }
    const value = BigInt(amount);
    if (value > U64_MAX) {
        throw new Error(`amount does not fit in a u64: ${amount}`);
    }
    return value;
}

function generateMerkleTree(snapshotPath: string, outputPath: string): void {
    const snapshot: Snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));

    console.log(`Processing snapshot from ${snapshot.chain_id}`);
    console.log(`Snapshot height: ${snapshot.snapshot_height}`);
    console.log(`Total entries: ${snapshot.entries.length}`);

    const validEntries: Array<SnapshotEntry & { addressParsed: Address; amountParsed: bigint }> = [];
    for (const entry of snapshot.entries) {
        try {
            validEntries.push({
                ...entry,
                addressParsed: address(entry.solana_address),
                amountParsed: parseAmount(entry.amount),
            });
        } catch (error) {
            console.warn(
                `Skipping invalid entry for ${entry.source_address}: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            );
        }
    }

    if (validEntries.length === 0) {
        throw new Error('snapshot must contain at least one valid entry');
    }

    const addressEncoder = getAddressEncoder();
    const tree = new MerkleTree(
        validEntries.map(entry => leafBytes(addressEncoder.encode(entry.addressParsed), entry.amountParsed)),
    );
    const merkleRoot = Array.from(tree.root);
    const merkleRootHex = tree.root.toString('hex');
    console.log(`\nMerkle root: 0x${merkleRootHex}`);

    const proofs: ProofEntry[] = validEntries.map((entry, index) => ({
        solana_address: entry.solana_address,
        source_address: entry.source_address,
        amount: entry.amountParsed.toString(),
        index,
        proof: tree.proof(index).toString('hex'),
    }));

    const totalAmount = validEntries.reduce((sum, entry) => sum + entry.amountParsed, 0n);

    const output = {
        merkle_root: merkleRoot,
        merkle_root_hex: merkleRootHex,
        total_amount: totalAmount.toString(),
        total_entries: validEntries.length,
        snapshot_height: snapshot.snapshot_height,
        proofs,
    };

    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
    console.log(`\nOutput written to: ${outputPath}`);
    console.log(`Total claimable amount: ${output.total_amount}`);
}

const args = process.argv.slice(2);
if (args.length < 2) {
    console.log('Usage: pnpm generate-tree <snapshot.json> <output.json>');
    console.log('\nExample:');
    console.log('  pnpm generate-tree scripts/sample-snapshot.json merkle-output.json');
    process.exit(1);
}

generateMerkleTree(args[0], args[1]);
