import {
    AccountRole,
    addEncoderSizePrefix,
    type Address,
    getStructEncoder,
    getU8Encoder,
    getU32Encoder,
    getUtf8Encoder,
    type TransactionSigner,
} from '@solana/kit';
import { SYSTEM_PROGRAM_ADDRESS } from '@solana-program/system';
import type { AddressInfo } from '../state';

// Instruction data layout: the program deserializes the whole payload as an `AddressInfo`.
export const createAddressInfoEncoder = getStructEncoder([
    ['name', addEncoderSizePrefix(getUtf8Encoder(), getU32Encoder())],
    ['houseNumber', getU8Encoder()],
    ['street', addEncoderSizePrefix(getUtf8Encoder(), getU32Encoder())],
    ['city', addEncoderSizePrefix(getUtf8Encoder(), getU32Encoder())],
]);

export function createCreateAddressInfoInstruction(
    addressInfoAccount: TransactionSigner,
    payer: TransactionSigner,
    programId: Address,
    addressInfo: AddressInfo,
) {
    return {
        programAddress: programId,
        accounts: [
            {
                address: addressInfoAccount.address,
                role: AccountRole.WRITABLE_SIGNER,
                signer: addressInfoAccount,
            },
            { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
            { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
        ],
        data: createAddressInfoEncoder.encode(addressInfo),
    };
}
