import { type AccountMeta, Keypair, PublicKey } from '@solana/web3.js';

import * as bs58 from 'bs58';

export function loadWalletKey(keypairFile: string): Keypair {
    const fs = require('node:fs');
    return Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync(keypairFile).toString())));
}

export function decode(stuff: string) {
    return bufferToArray(bs58.decode(stuff));
}
function bufferToArray(buffer: Buffer): number[] {
    const nums: number[] = [];
    for (let i = 0; i < buffer.length; i++) {
        nums.push(buffer[i]);
    }
    return nums;
}
export const mapProof = (assetProof: { proof: string[] }): AccountMeta[] => {
    if (!assetProof.proof || assetProof.proof.length === 0) {
        throw new Error('Proof is empty');
    }
    return assetProof.proof.map(node => ({
        pubkey: new PublicKey(node),
        isSigner: false,
        isWritable: false,
    }));
};
