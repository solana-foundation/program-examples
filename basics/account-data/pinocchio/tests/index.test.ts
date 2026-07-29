import {
    AccountRole,
    type Address,
    appendTransactionMessageInstruction,
    createTransactionMessage,
    generateKeyPairSigner,
    type KeyPairSigner,
    lamports,
    pipe,
    setTransactionMessageFeePayerSigner,
    signTransactionMessageWithSigners,
} from '@solana/kit';
import { SYSTEM_PROGRAM_ADDRESS } from '@solana-program/system';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';

interface AddressInfo {
    name: string;
    house_number: number;
    street: string;
    city: string;
}

function toBytes(addressInfo: AddressInfo): Buffer {
    const data: number[] = [];

    // Add instruction discriminator
    data.push(0);

    // Pad name to 16 bytes (data[1..17])
    const nameBytes = Buffer.from(addressInfo.name, 'utf-8');
    const namePadded = Buffer.alloc(16);
    nameBytes.copy(namePadded, 0, 0, Math.min(nameBytes.length, 16));
    data.push(...namePadded);

    // Add 1 byte padding at index 17
    data.push(0);

    // Add house_number at index 18
    data.push(addressInfo.house_number);

    // Pad street to 16 bytes (data[19..35])
    const streetBytes = Buffer.from(addressInfo.street, 'utf-8');
    const streetPadded = Buffer.alloc(16);
    streetBytes.copy(streetPadded, 0, 0, Math.min(streetBytes.length, 16));
    data.push(...streetPadded);

    // Add 1 byte padding at index 35
    data.push(0);

    // Pad city to 16 bytes (data[36..52])
    const cityBytes = Buffer.from(addressInfo.city, 'utf-8');
    const cityPadded = Buffer.alloc(16);
    cityBytes.copy(cityPadded, 0, 0, Math.min(cityBytes.length, 16));
    data.push(...cityPadded);

    return Buffer.from(data);
}

function fromBytes(buffer: Buffer): AddressInfo {
    // name: bytes 0..16
    const nameBytes = buffer.subarray(0, 16);
    const name = nameBytes.toString('utf-8').replace(/\0/g, '');

    // house_number: byte 17
    const house_number = buffer[17];

    // street: bytes 18..34
    const streetBytes = buffer.subarray(18, 34);
    const street = streetBytes.toString('utf-8').replace(/\0/g, '');

    // city: bytes 35..51
    const cityBytes = buffer.subarray(35, 51);
    const city = cityBytes.toString('utf-8').replace(/\0/g, '');

    return { name, house_number, street, city };
}

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

        const addressInfo: AddressInfo = {
            name: 'Joe C',
            house_number: 136,
            street: 'Mile High Dr.',
            city: 'Solana Beach',
        };

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
            data: new Uint8Array(toBytes(addressInfo)),
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

        const readAddressInfo = fromBytes(Buffer.from(accountInfo.data));

        console.log(`Name     : ${readAddressInfo.name}`);
        console.log(`House Num: ${readAddressInfo.house_number}`);
        console.log(`Street   : ${readAddressInfo.street}`);
        console.log(`City     : ${readAddressInfo.city}`);
    });
});
