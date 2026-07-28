import { type PublicKey, TransactionInstruction } from '@solana/web3.js';
import { PROGRAM_ID } from '../';

export type IncrementInstructionAccounts = {
    counter: PublicKey;
};

export function createIncrementInstruction(accounts: IncrementInstructionAccounts): TransactionInstruction {
    return new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
            {
                pubkey: accounts.counter,
                isSigner: false,
                isWritable: true,
            },
        ],
        data: Buffer.from([0x0]),
    });
}
