import { readFileSync } from 'node:fs';
import { createKeyPairSignerFromBytes, type KeyPairSigner } from '@solana/kit';

export function createKeypairFromFile(path: string): Promise<KeyPairSigner> {
    return createKeyPairSignerFromBytes(Uint8Array.from(JSON.parse(readFileSync(path, 'utf-8'))));
}
