import {
    AccountRole,
    type Address,
    getStructEncoder,
    getU8Encoder,
    getU64Encoder,
    type TransactionSigner,
} from '@solana/kit';
import { SYSTEM_PROGRAM_ADDRESS } from '@solana-program/system';
import { ASSOCIATED_TOKEN_PROGRAM_ADDRESS, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import { MyInstruction } from '.';

// Instruction data layout, matching the program's `MyInstruction::TransferTokens(TransferTokensArgs)` variant.
export const transferTokensEncoder = getStructEncoder([
    ['instruction', getU8Encoder()],
    ['quantity', getU64Encoder()],
]);

export function createTransferTokensInstruction(
    mint: Address,
    fromAssociatedTokenAccount: Address,
    toAssociatedTokenAccount: Address,
    owner: TransactionSigner,
    recipient: Address,
    payer: TransactionSigner,
    programId: Address,
    quantity: bigint,
) {
    return {
        programAddress: programId,
        accounts: [
            { address: mint, role: AccountRole.WRITABLE },
            { address: fromAssociatedTokenAccount, role: AccountRole.WRITABLE },
            { address: toAssociatedTokenAccount, role: AccountRole.WRITABLE },
            { address: owner.address, role: AccountRole.WRITABLE_SIGNER, signer: owner },
            // Recipient just needs to be named, not to sign — receiving tokens
            // must never require the recipient's approval.
            { address: recipient, role: AccountRole.READONLY },
            { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
            { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            { address: ASSOCIATED_TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
        ],
        data: transferTokensEncoder.encode({ instruction: MyInstruction.TransferTokens, quantity }),
    };
}
