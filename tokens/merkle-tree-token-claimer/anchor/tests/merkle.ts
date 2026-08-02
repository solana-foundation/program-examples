import { createHash } from 'node:crypto';

// Mirrors the on-chain verifier in programs/merkle-tree-token-claimer/src/lib.rs:
// leaves are sha256-hashed, pairs are sha256(left || right), and a level with an
// odd number of nodes duplicates its last node.

export function sha256(bytes: Uint8Array): Buffer {
    return createHash('sha256').update(bytes).digest();
}

export function hashPair(left: Uint8Array, right: Uint8Array): Buffer {
    return sha256(Buffer.concat([left, right]));
}

// A claim leaf is exactly 40 bytes: [wallet pubkey (32) | amount (u64 LE, 8)].
export function leafBytes(wallet: Uint8Array, amount: bigint): Buffer {
    const amountLe = Buffer.alloc(8);
    amountLe.writeBigUInt64LE(amount);
    return Buffer.concat([Buffer.from(wallet), amountLe]);
}

export class MerkleTree {
    private readonly levels: Buffer[][];

    constructor(leaves: Uint8Array[]) {
        let level = leaves.map(sha256);
        this.levels = [level];
        while (level.length > 1) {
            const next: Buffer[] = [];
            for (let i = 0; i < level.length; i += 2) {
                const left = level[i];
                const right = i + 1 < level.length ? level[i + 1] : left;
                next.push(hashPair(left, right));
            }
            this.levels.push(next);
            level = next;
        }
    }

    get root(): Buffer {
        return this.levels[this.levels.length - 1][0];
    }

    // Concatenated 32-byte sibling hashes from leaf level to the root,
    // the exact `hashes` argument the claim instruction expects.
    proof(index: number): Buffer {
        const siblings: Buffer[] = [];
        for (let depth = 0; depth < this.levels.length - 1; depth++) {
            const level = this.levels[depth];
            const siblingIndex = index % 2 === 0 ? index + 1 : index - 1;
            siblings.push(level[siblingIndex] ?? level[index]);
            index = Math.floor(index / 2);
        }
        return Buffer.concat(siblings);
    }
}
