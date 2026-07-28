import { Connection, Keypair, PublicKey, SystemProgram, sendAndConfirmTransaction, Transaction } from '@solana/web3.js';
import { describe, it } from 'mocha';
import {
    type AddCarArgs,
    Car,
    createAddCarInstruction,
    createBookRentalInstruction,
    createPickUpCarInstruction,
    createReturnCarInstruction,
    RentalOrder,
    RentalOrderStatus,
} from './generated';

function loadKeypairFromFile(path: string): Keypair {
    return Keypair.fromSecretKey(Buffer.from(JSON.parse(require('node:fs').readFileSync(path, 'utf-8'))));
}

const carBmw: AddCarArgs = {
    year: 2020,
    make: 'BMW',
    model: 'iX1',
};

const carMercedes: AddCarArgs = {
    year: 2019,
    make: 'Mercedes-Benz',
    model: 'EQS',
};

const rentalInfo = {
    name: 'Fred Flinstone',
    pickUpDate: '01/28/2023 8:00 AM',
    returnDate: '01/28/2023 10:00 PM',
    price: 300,
};

describe('Car Rental Service', () => {
    const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
    const payer = loadKeypairFromFile(`${require('node:os').homedir()}/.config/solana/id.json`);
    const program = loadKeypairFromFile('./program/target/deploy/car_rental_service-keypair.json');

    let bmwPublicKey: PublicKey;
    let _mercedesPublicKey: PublicKey;

    async function createCar(car: AddCarArgs): Promise<PublicKey> {
        const carAccountPublicKey = PublicKey.findProgramAddressSync(
            [Buffer.from('car'), Buffer.from(car.make), Buffer.from(car.model)],
            program.publicKey,
        )[0];
        const ix = createAddCarInstruction(
            {
                carAccount: carAccountPublicKey,
                payer: payer.publicKey,
                systemProgram: SystemProgram.programId,
            },
            { addCarArgs: { ...car } },
        );
        const sx = await sendAndConfirmTransaction(connection, new Transaction().add(ix), [payer], {
            skipPreflight: true,
        });
        await connection.confirmTransaction(sx);
        const carData = await Car.fromAccountAddress(connection, carAccountPublicKey);
        console.log('New car created:');
        console.log(`   Year    : ${carData.year}`);
        console.log(`   Make    : ${carData.make}`);
        console.log(`   Model   : ${carData.model}`);
        return carAccountPublicKey;
    }

    it('Create a car that can be rented', async () => {
        bmwPublicKey = await createCar(carBmw);
    });
    it('Create another car that can be rented', async () => {
        _mercedesPublicKey = await createCar(carMercedes);
    });

    const evaluateStatus = (status: RentalOrderStatus): string => {
        if (status === RentalOrderStatus.Created) return 'Created';
        if (status === RentalOrderStatus.PickedUp) return 'Picked Up';
        return 'Returned';
    };

    async function printRentalDetails(rentalPublicKey: PublicKey, carPublicKey: PublicKey) {
        const rentalData = await RentalOrder.fromAccountAddress(connection, rentalPublicKey);
        const carData = await Car.fromAccountAddress(connection, carPublicKey);
        console.log('Rental booked:');
        console.log('   Vehicle details:');
        console.log(`       Year    : ${carData.year}`);
        console.log(`       Make    : ${carData.make}`);
        console.log(`       Model   : ${carData.model}`);
        console.log(`   Name    : ${rentalData.name}`);
        console.log(`   Pick Up : ${rentalData.pickUpDate}`);
        console.log(`   Return  : ${rentalData.returnDate}`);
        console.log(`   Price   : ${rentalData.price}`);
        console.log(`   Status  : ${evaluateStatus(rentalData.status)}`);
    }

    it('Book a new rental', async () => {
        const rentalAccountPublicKey = PublicKey.findProgramAddressSync(
            [Buffer.from('rental_order'), bmwPublicKey.toBuffer(), payer.publicKey.toBuffer()],
            program.publicKey,
        )[0];
        const ix = createBookRentalInstruction(
            {
                rentalAccount: rentalAccountPublicKey,
                carAccount: bmwPublicKey,
                payer: payer.publicKey,
                systemProgram: SystemProgram.programId,
            },
            {
                bookRentalArgs: { ...rentalInfo },
            },
        );
        const sx = await sendAndConfirmTransaction(connection, new Transaction().add(ix), [payer]);
        await connection.confirmTransaction(sx);
        await printRentalDetails(rentalAccountPublicKey, bmwPublicKey);
    });

    it('Pick up your rental car', async () => {
        const rentalAccountPublicKey = PublicKey.findProgramAddressSync(
            [Buffer.from('rental_order'), bmwPublicKey.toBuffer(), payer.publicKey.toBuffer()],
            program.publicKey,
        )[0];
        const ix = createPickUpCarInstruction({
            rentalAccount: rentalAccountPublicKey,
            carAccount: bmwPublicKey,
            payer: payer.publicKey,
        });
        const sx = await sendAndConfirmTransaction(connection, new Transaction().add(ix), [payer]);
        await connection.confirmTransaction(sx);
        await printRentalDetails(rentalAccountPublicKey, bmwPublicKey);
    });

    it('Return your rental car', async () => {
        const rentalAccountPublicKey = PublicKey.findProgramAddressSync(
            [Buffer.from('rental_order'), bmwPublicKey.toBuffer(), payer.publicKey.toBuffer()],
            program.publicKey,
        )[0];
        const ix = createReturnCarInstruction({
            rentalAccount: rentalAccountPublicKey,
            carAccount: bmwPublicKey,
            payer: payer.publicKey,
        });
        const sx = await sendAndConfirmTransaction(connection, new Transaction().add(ix), [payer]);
        await connection.confirmTransaction(sx);
        await printRentalDetails(rentalAccountPublicKey, bmwPublicKey);
    });
});
