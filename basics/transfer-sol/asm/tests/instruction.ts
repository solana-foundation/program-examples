import { AccountRole, type Address, getU64Encoder, type TransactionSigner } from '@solana/kit';
import { SYSTEM_PROGRAM_ADDRESS } from '@solana-program/system';

export function createTransferInstruction(
    sender: TransactionSigner,
    recipientAddress: Address,
    programAddress: Address,
    lamports: bigint,
) {
    return {
        programAddress,
        accounts: [
            { address: sender.address, role: AccountRole.WRITABLE_SIGNER, signer: sender },
            { address: recipientAddress, role: AccountRole.WRITABLE },
            { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
        ],
        data: getU64Encoder().encode(lamports),
    };
}
