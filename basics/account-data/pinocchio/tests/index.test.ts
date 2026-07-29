import { readFileSync } from 'node:fs';
import { Keypair, LAMPORTS_PER_SOL, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import { LiteSVM, Rent } from 'litesvm';

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
    // Load the program keypair
    const programKeypairPath = new URL(
        './fixtures/account_data_pinocchio_program-keypair.json',
        // @ts-expect-error
        import.meta.url,
    ).pathname;
    const programKeypairData = JSON.parse(readFileSync(programKeypairPath, 'utf-8'));
    const programKeypair = Keypair.fromSecretKey(new Uint8Array(programKeypairData));
    const PROGRAM_ID = programKeypair.publicKey;

    // Load the program
    const programPath = new URL(
        './fixtures/account_data_pinocchio_program.so',
        // @ts-expect-error
        import.meta.url,
    ).pathname;

    const litesvm = new LiteSVM();
    // pinocchio 0.11 Rent reads a single lamports-per-byte rate from the first 8 bytes of the sysvar
    litesvm.addProgramFromFile(PROGRAM_ID, programPath);

    const payer = Keypair.generate();
    litesvm.airdrop(payer.publicKey, BigInt(100 * LAMPORTS_PER_SOL));

    const addressInfoAccount = Keypair.generate();

    it('Create the address info account', () => {
        console.log(`Program Address    : ${PROGRAM_ID}`);
        console.log(`Payer Address      : ${payer.publicKey}`);
        console.log(`Address Info Acct  : ${addressInfoAccount.publicKey}`);

        const addressInfo: AddressInfo = {
            name: 'Joe C',
            house_number: 136,
            street: 'Mile High Dr.',
            city: 'Solana Beach',
        };

        const ix = new TransactionInstruction({
            keys: [
                {
                    pubkey: addressInfoAccount.publicKey,
                    isSigner: true,
                    isWritable: true,
                },
                { pubkey: payer.publicKey, isSigner: true, isWritable: true },
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            ],
            programId: PROGRAM_ID,
            data: toBytes(addressInfo),
        });

        const tx = new Transaction().add(ix);
        tx.feePayer = payer.publicKey;
        tx.recentBlockhash = litesvm.latestBlockhash();
        tx.sign(payer, addressInfoAccount);

        litesvm.sendTransaction(tx);
    });

    it("Read the new account's data", () => {
        const accountInfo = litesvm.getAccount(addressInfoAccount.publicKey);

        if (!accountInfo) {
            throw new Error('Account not found');
        }

        const readAddressInfo = fromBytes(Buffer.from(accountInfo.data));

        console.log(`Name     : ${readAddressInfo.name}`);
        console.log(`House Num: ${readAddressInfo.house_number}`);
        console.log(`Street   : ${readAddressInfo.street}`);
        console.log(`City     : ${readAddressInfo.city}`);
    });
});
