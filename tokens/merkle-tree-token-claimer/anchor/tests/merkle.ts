import { createHash } from 'node:crypto';

// Mirrors the on-chain verifier in programs/merkle-tree-token-claimer/src/lib.rs:
// leaves are sha256-hashed, pairs are sha256(left || right), and a level with an
// odd number of nodes pairs its last node with a zero hash.
//
// Padding with a zero hash (rather than duplicating the last node) matters for
// security: duplication makes the parent sha256(C || C), which verifies whether
// the claimant submits index i or index i + 1 — two distinct receipt PDAs for
// one leaf, allowing a double claim. A zero-hash sibling keeps the pair
// asymmetric, so exactly one index verifies per leaf.

export function sha256(bytes: Uint8Array): Buffer {
    return createHash('sha256').update(bytes).digest();
}

export function hashPair(left: Uint8Array, right: Uint8Array): Buffer {
    return sha256(Buffer.concat([left, right]));
}

// A claim leaf is exactly 40 bytes: [wallet pubkey (32) | amount (u64 LE, 8)].
// The wallet is any byte array, including the read-only arrays kit encoders return.
export function leafBytes(wallet: ArrayLike<number>, amount: bigint): Buffer {
    const amountLe = Buffer.alloc(8);
    amountLe.writeBigUInt64LE(amount);
    return Buffer.concat([Uint8Array.from(wallet), amountLe]);
}

export const ZERO_HASH: Buffer = Buffer.alloc(32);

export class MerkleTree {
    private readonly levels: Buffer[][];

    constructor(leaves: Uint8Array[]) {
        if (leaves.length === 0) {
            throw new Error('cannot build a Merkle tree with no leaves');
        }
        let level = leaves.map(sha256);
        this.levels = [level];
        while (level.length > 1) {
            const next: Buffer[] = [];
            for (let i = 0; i < level.length; i += 2) {
                const left = level[i];
                const right = i + 1 < level.length ? level[i + 1] : ZERO_HASH;
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
            siblings.push(level[siblingIndex] ?? ZERO_HASH);
            index = Math.floor(index / 2);
        }
        return Buffer.concat(siblings);
    }
}
