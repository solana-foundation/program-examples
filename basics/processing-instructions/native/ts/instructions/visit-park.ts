import {
    AccountRole,
    addEncoderSizePrefix,
    type Address,
    getStructEncoder,
    getU32Encoder,
    getUtf8Encoder,
    type TransactionSigner,
} from '@solana/kit';

// Instruction data layout, matching the program's `InstructionData` struct.
export const visitParkEncoder = getStructEncoder([
    ['name', addEncoderSizePrefix(getUtf8Encoder(), getU32Encoder())],
    ['height', getU32Encoder()],
]);

export function createVisitParkInstruction(payer: TransactionSigner, programId: Address, name: string, height: number) {
    return {
        programAddress: programId,
        accounts: [{ address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer }],
        data: visitParkEncoder.encode({ name, height }),
    };
}
