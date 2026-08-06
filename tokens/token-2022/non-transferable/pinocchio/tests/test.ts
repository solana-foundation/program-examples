import * as path from 'node:path';
import {
    AccountRole,
    type Address,
    appendTransactionMessageInstruction,
    createTransactionMessage,
    generateKeyPairSigner,
    getStructEncoder,
    getU8Encoder,
    lamports,
    pipe,
    setTransactionMessageFeePayerSigner,
    signTransactionMessageWithSigners,
    unwrapOption,
} from '@solana/kit';
import { SYSVAR_RENT_ADDRESS } from '@solana/sysvars';
import { SYSTEM_PROGRAM_ADDRESS } from '@solana-program/system';
import { getMintDecoder, TOKEN_2022_PROGRAM_ADDRESS } from '@solana-program/token-2022';
import { assert } from 'chai';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';

// Instruction data layout, matching the program's `CreateTokenArgs`.
const createTokenArgsEncoder = getStructEncoder([['tokenDecimals', getU8Encoder()]]);

// Token-2022 lays a mint with one (valueless) extension out as:
//   base account length (165) + account-type byte (1) + TLV entry (4) = 170
const EXTENDED_MINT_SIZE = 170;

// The compiled program artifact, produced by `build-and-test` into ./fixtures.
// The npm scripts always run from the package root, so resolve from the cwd.
const PROGRAM_SO = path.join(process.cwd(), 'tests', 'fixtures', 'token_2022_non_transferable_pinocchio_program.so');

describe('Token-2022 Non-Transferable (Pinocchio)', () => {
    let svm: LiteSVM;
    let programId: Address;

    before(async () => {
        svm = new LiteSVM();
        // The program never asserts its own id, so any address works; a generated
        // one keeps the test self-contained.
        programId = (await generateKeyPairSigner()).address;
        svm.addProgramFromFile(programId, PROGRAM_SO);
    });

    it('Creates a Token-2022 non-transferable mint', async () => {
        const decimals = 9;
        const payer = await generateKeyPairSigner();
        svm.airdrop(payer.address, lamports(1_000_000_000n));

        const mint = await generateKeyPairSigner();

        const data = createTokenArgsEncoder.encode({ tokenDecimals: decimals });

        const ix = {
            programAddress: programId,
            accounts: [
                { address: mint.address, role: AccountRole.WRITABLE_SIGNER, signer: mint }, // mint account
                { address: payer.address, role: AccountRole.READONLY }, // mint authority
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

        // Owned by Token-2022, and sized for exactly one valueless extension.
        assert.equal(mintAccount.programAddress, TOKEN_2022_PROGRAM_ADDRESS);
        assert.equal(mintAccount.data.length, EXTENDED_MINT_SIZE);

        // Decode the base mint fields and its TLV extensions with the official
        // Token-2022 codec instead of reading raw byte offsets by hand.
        const mintState = getMintDecoder().decode(mintAccount.data);
        assert.equal(mintState.decimals, decimals);

        // The NonTransferable extension is present; it carries no value of its own.
        const extensions = unwrapOption(mintState.extensions) ?? [];
        const nonTransferable = extensions.find(e => e.__kind === 'NonTransferable');
        assert.isDefined(nonTransferable, 'NonTransferable extension not found on the mint');

        console.log('Mint address:', mint.address);
    });
});
