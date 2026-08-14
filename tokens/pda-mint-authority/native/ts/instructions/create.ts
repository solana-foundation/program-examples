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
    ['nft_title', addEncoderSizePrefix(getUtf8Encoder(), getU32Encoder())],
    ['nft_symbol', addEncoderSizePrefix(getUtf8Encoder(), getU32Encoder())],
    ['nft_uri', addEncoderSizePrefix(getUtf8Encoder(), getU32Encoder())],
]);

export function createCreateInstruction(
    mint: TransactionSigner,
    mintAuthority: Address,
    metadata: Address,
    payer: TransactionSigner,
    programId: Address,
    nftTitle: string,
    nftSymbol: string,
    nftUri: string,
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
            nft_title: nftTitle,
            nft_symbol: nftSymbol,
            nft_uri: nftUri,
        }),
    };
}
