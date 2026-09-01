import * as path from 'node:path';
import {
    AccountRole,
    type Address,
    appendTransactionMessageInstruction,
    createTransactionMessage,
    generateKeyPairSigner,
    getProgramDerivedAddress,
    lamports,
    pipe,
    setTransactionMessageFeePayerSigner,
    signTransactionMessageWithSigners,
    unwrapOption,
} from '@solana/kit';
import { SYSTEM_PROGRAM_ADDRESS } from '@solana-program/system';
import { getMintDecoder, TOKEN_2022_PROGRAM_ADDRESS } from '@solana-program/token-2022';
import { assert } from 'chai';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';

// A Token-2022 mint with the GroupPointer extension:
//   base account length (165) + account-type byte (1) + GroupPointer TLV (68) = 234
const GROUP_MINT_SIZE = 234;

const PROGRAM_SO = path.join(process.cwd(), 'tests', 'fixtures', 'token_2022_group_pinocchio_program.so');

describe('Token-2022 Group (Pinocchio)', () => {
    let svm: LiteSVM;
    let programId: Address;

    before(async () => {
        svm = new LiteSVM();
        programId = (await generateKeyPairSigner()).address;
        svm.addProgramFromFile(programId, PROGRAM_SO);
    });

    it('Creates a group mint with the GroupPointer extension', async () => {
        const payer = await generateKeyPairSigner();
        svm.airdrop(payer.address, lamports(1_000_000_000n));

        // The mint is the program's `[b"group"]` PDA — the client addresses it
        // without passing it in, matching the anchor example.
        const [mintPda] = await getProgramDerivedAddress({
            programAddress: programId,
            seeds: [new TextEncoder().encode('group')],
        });

        const ix = {
            programAddress: programId,
            accounts: [
                { address: mintPda, role: AccountRole.WRITABLE }, // mint PDA (program-signed)
                { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer }, // payer
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY }, // system program
                { address: TOKEN_2022_PROGRAM_ADDRESS, role: AccountRole.READONLY }, // Token-2022 program
            ],
        };

        const tx = pipe(
            createTransactionMessage({ version: 0 }),
            m => setTransactionMessageFeePayerSigner(payer, m),
            m => svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
            m => appendTransactionMessageInstruction(ix, m),
        );
        const result = svm.sendTransaction(await signTransactionMessageWithSigners(tx));
        if (result instanceof FailedTransactionMetadata) {
            throw new Error(`Transaction failed: ${result.err()}`);
        }

        const account = svm.getAccount(mintPda);
        if (!account?.exists) throw new Error('Group mint not found');
        assert.equal(account.programAddress, TOKEN_2022_PROGRAM_ADDRESS);
        assert.equal(account.data.length, GROUP_MINT_SIZE);

        // Decode the mint and its TLV extensions with the official codec.
        const mint = getMintDecoder().decode(account.data);
        const extensions = unwrapOption(mint.extensions) ?? [];
        const groupPointer = extensions.find(e => e.__kind === 'GroupPointer');
        if (groupPointer?.__kind !== 'GroupPointer') throw new Error('GroupPointer extension not found');

        // The mint points at itself: authority and group address are both the PDA.
        assert.equal(unwrapOption(groupPointer.authority), mintPda);
        assert.equal(unwrapOption(groupPointer.groupAddress), mintPda);

        console.log('Group mint address:', mintPda);
    });
});
