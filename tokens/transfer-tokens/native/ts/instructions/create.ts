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
import { TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import { MyInstruction } from '.';
import { SYSVAR_RENT_ADDRESS, TOKEN_METADATA_PROGRAM_ADDRESS } from '../constants';

// Instruction data layout, matching the program's `MyInstruction::Create(CreateTokenArgs)` variant.
export const createEncoder = getStructEncoder([
    ['instruction', getU8Encoder()],
    ['token_title', addEncoderSizePrefix(getUtf8Encoder(), getU32Encoder())],
    ['token_symbol', addEncoderSizePrefix(getUtf8Encoder(), getU32Encoder())],
    ['token_uri', addEncoderSizePrefix(getUtf8Encoder(), getU32Encoder())],
    ['decimals', getU8Encoder()],
]);

export function createCreateInstruction(
    mint: TransactionSigner,
    mintAuthority: Address,
    metadata: Address,
    payer: TransactionSigner,
    programId: Address,
    tokenTitle: string,
    tokenSymbol: string,
    tokenUri: string,
    decimals: number,
) {
    return {
        programAddress: programId,
        accounts: [
            { address: mint.address, role: AccountRole.WRITABLE_SIGNER, signer: mint },
            { address: mintAuthority, role: AccountRole.WRITABLE },
            { address: metadata, role: AccountRole.WRITABLE },
            { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
            { address: SYSVAR_RENT_ADDRESS, role: AccountRole.READONLY },
            { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            { address: TOKEN_METADATA_PROGRAM_ADDRESS, role: AccountRole.READONLY },
        ],
        data: createEncoder.encode({
            instruction: MyInstruction.Create,
            token_title: tokenTitle,
            token_symbol: tokenSymbol,
            token_uri: tokenUri,
            decimals,
        }),
    };
}
