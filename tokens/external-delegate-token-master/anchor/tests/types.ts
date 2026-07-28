// tests/types.ts
import type { PublicKey } from '@solana/web3.js';

export interface ProgramTestContext {
    connection: any;
    programs: {
        programId: PublicKey;
        program: string;
    }[];
    grantLamports: (address: PublicKey, amount: number) => Promise<void>;
    terminate: () => Promise<void>;
}

export interface UserAccount {
    authority: PublicKey;
    ethereumAddress: number[];
}
