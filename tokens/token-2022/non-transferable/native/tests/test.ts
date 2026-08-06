import * as path from 'node:path';
import {
    AccountRole,
    type Address,
    appendTransactionMessageInstruction,
    createTransactionMessage,
    generateKeyPairSigner,
    getStructEncoder,
    getU8Encoder,
    type KeyPairSigner,
    lamports,
    pipe,
    setTransactionMessageFeePayerSigner,
    signTransactionMessageWithSigners,
} from '@solana/kit';
import { SYSVAR_RENT_ADDRESS } from '@solana/sysvars';
import { SYSTEM_PROGRAM_ADDRESS } from '@solana-program/system';
import { TOKEN_2022_PROGRAM_ADDRESS } from '@solana-program/token-2022';
import { assert } from 'chai';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';

// Instruction data layout, matching the program's `CreateTokenArgs`.
const createTokenArgsEncoder = getStructEncoder([['tokenDecimals', getU8Encoder()]]);

const PROGRAM_SO = path.join(process.cwd(), 'tests', 'fixtures', 'token_2022_non_transferable_program.so');

describe('Create Token', () => {
    let svm: LiteSVM;
    let programId: Address;
    let payer: KeyPairSigner;

    before(async () => {
        svm = new LiteSVM();
        programId = (await generateKeyPairSigner()).address;
        svm.addProgramFromFile(programId, PROGRAM_SO);

        payer = await generateKeyPairSigner();
        svm.airdrop(payer.address, lamports(1_000_000_000n));
    });

    it('Create a Token-22 SPL-Token !', async () => {
        const mint = await generateKeyPairSigner();

        const data = createTokenArgsEncoder.encode({ tokenDecimals: 9 });

        const ix = {
            programAddress: programId,
            accounts: [
                { address: mint.address, role: AccountRole.WRITABLE_SIGNER, signer: mint }, // Mint account
                { address: payer.address, role: AccountRole.WRITABLE }, // Mint authority account
                { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer }, // Transaction Payer
                { address: SYSVAR_RENT_ADDRESS, role: AccountRole.READONLY }, // Rent account
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY }, // System program
                { address: TOKEN_2022_PROGRAM_ADDRESS, role: AccountRole.READONLY }, // Token program
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
            throw new Error(`transaction failed: ${result.toString()}`);
        }

        assert(result.logs()[0].startsWith(`Program ${programId}`));
        console.log('Token Mint Address: ', mint.address);
    });
});
