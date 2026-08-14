import {
    AccountRole,
    addEncoderSizePrefix,
    type Address,
    getStructEncoder,
    getU32Encoder,
    getUtf8Encoder,
    type TransactionSigner,
} from '@solana/kit';

// Instruction data layout, matching the field order the program's `process_instruction` reads.
export const carnivalEncoder = getStructEncoder([
    ['name', addEncoderSizePrefix(getUtf8Encoder(), getU32Encoder())],
    ['height', getU32Encoder()],
    ['ticketCount', getU32Encoder()],
    ['attraction', addEncoderSizePrefix(getUtf8Encoder(), getU32Encoder())],
    ['attractionName', addEncoderSizePrefix(getUtf8Encoder(), getU32Encoder())],
]);

// The attraction the visitor is headed to, which selects the instruction handler.
export type Attraction = 'food' | 'game' | 'ride';

export type CarnivalInstructionData = {
    name: string;
    height: number;
    ticketCount: number;
    attraction: Attraction;
    attractionName: string;
};

export function createCarnivalInstruction(payer: TransactionSigner, programId: Address, data: CarnivalInstructionData) {
    return {
        programAddress: programId,
        accounts: [{ address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer }],
        data: carnivalEncoder.encode(data),
    };
}
