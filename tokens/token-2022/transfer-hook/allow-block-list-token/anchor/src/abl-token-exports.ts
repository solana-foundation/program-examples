// Here we export some useful types and functions for interacting with the Anchor program.
import { type AnchorProvider, Program } from '@anchor-lang/core';
import { type Cluster, PublicKey } from '@solana/web3.js';
import ABLTokenIDL from '../target/idl/abl_token.json';
import type { AblToken } from '../target/types/abl_token';

// Re-export the generated IDL and type
export { ABLTokenIDL };

// The programId is imported from the program IDL.
export const ABL_TOKEN_PROGRAM_ID = new PublicKey(ABLTokenIDL.address);

// This is a helper function to get the Basic Anchor program.
export function getABLTokenProgram(provider: AnchorProvider, address?: PublicKey): Program<AblToken> {
    return new Program(
        {
            ...ABLTokenIDL,
            address: address ? address.toBase58() : ABLTokenIDL.address,
        } as AblToken,
        provider,
    );
}

// This is a helper function to get the program ID for the Basic program depending on the cluster.
export function getABLTokenProgramId(cluster: Cluster) {
    switch (cluster) {
        case 'devnet':
        case 'testnet':
            // This is the program ID for the Basic program on devnet and testnet.
            return new PublicKey('6z68wfurCMYkZG51s1Et9BJEd9nJGUusjHXNt4dGbNNF');
        default:
            return ABL_TOKEN_PROGRAM_ID;
    }
}

//ABLTokenIDL.types["mode"]
