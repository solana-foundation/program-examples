import { Buffer } from 'node:buffer';
import { type PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';

export function createTransferInstruction(
    senderPubkey: PublicKey,
    recipientPubkey: PublicKey,
    programId: PublicKey,
    lamports: number,
): TransactionInstruction {
    const data = Buffer.alloc(8);
    data.writeBigUInt64LE(BigInt(lamports));

    return new TransactionInstruction({
        keys: [
            { pubkey: senderPubkey, isSigner: true, isWritable: true },
            { pubkey: recipientPubkey, isSigner: false, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        programId,
        data,
    });
}
