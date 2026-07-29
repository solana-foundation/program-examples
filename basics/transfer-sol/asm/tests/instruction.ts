import { AccountRole, type Address, type TransactionSigner } from '@solana/kit';
import { SYSTEM_PROGRAM_ADDRESS } from '@solana-program/system';

export function createTransferInstruction(
    sender: TransactionSigner,
    recipientAddress: Address,
    programAddress: Address,
    lamports: bigint,
) {
    const data = new Uint8Array(8);
    new DataView(data.buffer).setBigUint64(0, lamports, true);

    return {
        programAddress,
        accounts: [
            { address: sender.address, role: AccountRole.WRITABLE_SIGNER, signer: sender },
            { address: recipientAddress, role: AccountRole.WRITABLE },
            { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
        ],
        data,
    };
}
