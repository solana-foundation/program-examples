import {
    AccountRole,
    type Address,
    appendTransactionMessageInstruction,
    createTransactionMessage,
    fixDecoderSize,
    fixEncoderSize,
    generateKeyPairSigner,
    getStructDecoder,
    getStructEncoder,
    getU8Decoder,
    getU8Encoder,
    getUtf8Decoder,
    getUtf8Encoder,
    type KeyPairSigner,
    lamports,
    pipe,
    setTransactionMessageFeePayerSigner,
    signTransactionMessageWithSigners,
} from '@solana/kit';
import { SYSTEM_PROGRAM_ADDRESS } from '@solana-program/system';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';

// The on-chain account stores each field padded to a fixed width, with a single
// alignment byte before `house_number` and before `city`.
const createAddressInfoEncoder = getStructEncoder([
    ['discriminator', getU8Encoder()],
    ['name', fixEncoderSize(getUtf8Encoder(), 16)],
    ['namePadding', getU8Encoder()],
    ['houseNumber', getU8Encoder()],
    ['street', fixEncoderSize(getUtf8Encoder(), 16)],
    ['streetPadding', getU8Encoder()],
    ['city', fixEncoderSize(getUtf8Encoder(), 16)],
]);

const addressInfoDecoder = getStructDecoder([
    ['name', fixDecoderSize(getUtf8Decoder(), 16)],
    ['namePadding', getU8Decoder()],
    ['houseNumber', getU8Decoder()],
    ['street', fixDecoderSize(getUtf8Decoder(), 16)],
    ['streetPadding', getU8Decoder()],
    ['city', fixDecoderSize(getUtf8Decoder(), 16)],
]);

describe('Account Data!', () => {
    const litesvm = new LiteSVM();
    let programId: Address;
    let payer: KeyPairSigner;
    let addressInfoAccount: KeyPairSigner;

    before(async () => {
        // Load the program
        programId = (await generateKeyPairSigner()).address;
        litesvm.addProgramFromFile(programId, 'tests/fixtures/account_data_pinocchio_program.so');

        payer = await generateKeyPairSigner();
        litesvm.airdrop(payer.address, lamports(100_000_000_000n));

        addressInfoAccount = await generateKeyPairSigner();
    });

    it('Create the address info account', async () => {
        console.log(`Program Address    : ${programId}`);
        console.log(`Payer Address      : ${payer.address}`);
        console.log(`Address Info Acct  : ${addressInfoAccount.address}`);

        const ix = {
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
            data: createAddressInfoEncoder.encode({
                discriminator: 0,
                name: 'Joe C',
                namePadding: 0,
                houseNumber: 136,
                street: 'Mile High Dr.',
                streetPadding: 0,
                city: 'Solana Beach',
            }),
        };

        const transactionMessage = pipe(
            createTransactionMessage({ version: 0 }),
            m => setTransactionMessageFeePayerSigner(payer, m),
            m => litesvm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
            m => appendTransactionMessageInstruction(ix, m),
        );
        const signedTx = await signTransactionMessageWithSigners(transactionMessage);

        const result = litesvm.sendTransaction(signedTx);
        if (result instanceof FailedTransactionMetadata) {
            throw new Error(`transaction failed: ${result.toString()}`);
        }
    });

    it("Read the new account's data", () => {
        const accountInfo = litesvm.getAccount(addressInfoAccount.address);

        if (!accountInfo.exists) {
            throw new Error('Account not found');
        }

        const readAddressInfo = addressInfoDecoder.decode(accountInfo.data);

        console.log(`Name     : ${readAddressInfo.name}`);
        console.log(`House Num: ${readAddressInfo.houseNumber}`);
        console.log(`Street   : ${readAddressInfo.street}`);
        console.log(`City     : ${readAddressInfo.city}`);
    });
});
