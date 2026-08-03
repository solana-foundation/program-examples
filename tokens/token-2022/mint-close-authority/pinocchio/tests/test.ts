import * as path from 'node:path';
import {
    AccountRole,
    type Address,
    appendTransactionMessageInstruction,
    createTransactionMessage,
    generateKeyPairSigner,
    lamports,
    pipe,
    setTransactionMessageFeePayerSigner,
    signTransactionMessageWithSigners,
    unwrapOption,
} from '@solana/kit';
import { SYSVAR_RENT_ADDRESS } from '@solana/sysvars';
import { SYSTEM_PROGRAM_ADDRESS } from '@solana-program/system';
import { getMintDecoder, TOKEN_2022_PROGRAM_ADDRESS } from '@solana-program/token-2022';
import * as borsh from 'borsh';
import { assert } from 'chai';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';

// Borsh schema for the instruction data, matching the program's
// `CreateTokenArgs` (and the native example's wire format).
const CreateTokenArgsSchema: borsh.Schema = {
    struct: { token_decimals: 'u8' },
};

// Token-2022 lays a mint with one extension out as:
//   base account length (165) + account-type byte (1) + TLV entry (36) = 202
const EXTENDED_MINT_SIZE = 202;

// The compiled program artifact, produced by `build-and-test` into ./fixtures.
// The npm scripts always run from the package root, so resolve from the cwd.
const PROGRAM_SO = path.join(
    process.cwd(),
    'tests',
    'fixtures',
    'token_2022_mint_close_authority_pinocchio_program.so',
);

describe('Token-2022 Mint Close Authority (Pinocchio)', () => {
    let svm: LiteSVM;
    let programId: Address;

    before(async () => {
        svm = new LiteSVM();
        // The program never asserts its own id, so any address works; a generated
        // one keeps the test self-contained.
        programId = (await generateKeyPairSigner()).address;
        svm.addProgramFromFile(programId, PROGRAM_SO);
    });

    it('Creates a Token-2022 mint with a close authority', async () => {
        const decimals = 9;
        const payer = await generateKeyPairSigner();
        svm.airdrop(payer.address, lamports(1_000_000_000n));

        const mint = await generateKeyPairSigner();
        // A distinct key for the close authority so the stored-authority assertion
        // verifies it is sourced from account index 2, not the mint authority/payer.
        const closeAuthority = await generateKeyPairSigner();

        const data = borsh.serialize(CreateTokenArgsSchema, { token_decimals: decimals });

        const ix = {
            programAddress: programId,
            accounts: [
                { address: mint.address, role: AccountRole.WRITABLE_SIGNER, signer: mint }, // mint account
                { address: payer.address, role: AccountRole.READONLY }, // mint authority
                { address: closeAuthority.address, role: AccountRole.READONLY }, // close authority
                { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer }, // payer
                { address: SYSVAR_RENT_ADDRESS, role: AccountRole.READONLY }, // rent sysvar
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY }, // system program
                { address: TOKEN_2022_PROGRAM_ADDRESS, role: AccountRole.READONLY }, // Token-2022 program
            ],
            data,
        };

        const transactionMessage = pipe(
            createTransactionMessage({ version: 0 }),
            m => setTransactionMessageFeePayerSigner(payer, m),
            m => svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
            m => appendTransactionMessageInstruction(ix, m),
        );

        const signedTx = await signTransactionMessageWithSigners(transactionMessage);
        const result = svm.sendTransaction(signedTx);
        if (result instanceof FailedTransactionMetadata) {
            throw new Error(`Transaction failed: ${result.err()}`);
        }

        const mintAccount = svm.getAccount(mint.address);
        if (!mintAccount?.exists) throw new Error('Mint account not found');

        // Owned by Token-2022, and sized for exactly one extension.
        assert.equal(mintAccount.programAddress, TOKEN_2022_PROGRAM_ADDRESS);
        assert.equal(mintAccount.data.length, EXTENDED_MINT_SIZE);

        // Decode the base mint fields and its TLV extensions with the official
        // Token-2022 codec instead of reading raw byte offsets by hand.
        const mintState = getMintDecoder().decode(mintAccount.data);
        assert.equal(mintState.decimals, decimals);

        const extensions = unwrapOption(mintState.extensions) ?? [];
        const closeAuthorityExtension = extensions.find(e => e.__kind === 'MintCloseAuthority');
        if (closeAuthorityExtension?.__kind !== 'MintCloseAuthority') {
            throw new Error('MintCloseAuthority extension not found on the mint');
        }

        // The configured close authority was stored in the extension.
        assert.equal(closeAuthorityExtension.closeAuthority, closeAuthority.address);

        console.log('Mint address:', mint.address);
    });
});
