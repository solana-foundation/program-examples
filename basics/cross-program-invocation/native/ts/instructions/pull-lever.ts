import {
    AccountRole,
    addEncoderSizePrefix,
    type Address,
    getStructEncoder,
    getU32Encoder,
    getUtf8Encoder,
} from '@solana/kit';

// Instruction data layout, matching the lever program's `SetPowerStatus` struct. The hand
// program deserializes this same struct and forwards it unchanged to the lever program.
export const pullLeverEncoder = getStructEncoder([['name', addEncoderSizePrefix(getUtf8Encoder(), getU32Encoder())]]);

export function createPullLeverInstruction(
    power: Address,
    leverProgramId: Address,
    handProgramId: Address,
    name: string,
) {
    return {
        programAddress: handProgramId,
        accounts: [
            { address: power, role: AccountRole.WRITABLE },
            { address: leverProgramId, role: AccountRole.READONLY },
        ],
        data: pullLeverEncoder.encode({ name }),
    };
}
