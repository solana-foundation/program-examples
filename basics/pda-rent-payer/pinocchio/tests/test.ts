import {
    Keypair,
    LAMPORTS_PER_SOL,
    PublicKey,
    SystemProgram,
    Transaction,
    TransactionInstruction,
} from '@solana/web3.js';
import { assert } from 'chai';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';

const INIT_RENT_VAULT_DISCRIMINATOR = 0;
const CREATE_NEW_ACCOUNT_DISCRIMINATOR = 1;
const FUND_LAMPORTS = 1_000_000_000n;

describe('PDA Rent-Payer', () => {
    const PROGRAM_ID = PublicKey.unique();
    const svm = new LiteSVM();
    svm.addProgramFromFile(PROGRAM_ID, 'tests/fixtures/pda_rent_payer_pinocchio_program.so');

    const payer = Keypair.generate();
    svm.airdrop(payer.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

    const [rentVaultPda, bump] = PublicKey.findProgramAddressSync([Buffer.from('rent_vault')], PROGRAM_ID);
    const rentExemptBalance = svm.getRent().minimumBalance(0n);

    function balance(pubkey: PublicKey): bigint {
        const lamports = svm.getBalance(pubkey);
        assert(lamports !== null, `expected ${pubkey.toBase58()} to exist`);
        return lamports;
    }

    it('Initialize the Rent Vault', () => {
        const data = Buffer.alloc(10);
        data.writeUInt8(INIT_RENT_VAULT_DISCRIMINATOR, 0);
        data.writeUInt8(bump, 1);
        data.writeBigUInt64LE(FUND_LAMPORTS, 2);

        const ix = new TransactionInstruction({
            keys: [
                { pubkey: rentVaultPda, isSigner: false, isWritable: true },
                { pubkey: payer.publicKey, isSigner: true, isWritable: true },
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            ],
            programId: PROGRAM_ID,
            data,
        });

        const tx = new Transaction();
        tx.recentBlockhash = svm.latestBlockhash();
        tx.add(ix).sign(payer);

        const result = svm.sendTransaction(tx);
        assert(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);

        assert.equal(balance(rentVaultPda), rentExemptBalance + FUND_LAMPORTS);
    });

    it('Create a new account using the Rent Vault', () => {
        const newAccount = Keypair.generate();
        const vaultBalanceBefore = balance(rentVaultPda);

        const ix = new TransactionInstruction({
            keys: [
                { pubkey: newAccount.publicKey, isSigner: true, isWritable: true },
                { pubkey: rentVaultPda, isSigner: false, isWritable: true },
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            ],
            programId: PROGRAM_ID,
            data: Buffer.from([CREATE_NEW_ACCOUNT_DISCRIMINATOR, bump]),
        });

        const tx = new Transaction();
        tx.recentBlockhash = svm.latestBlockhash();
        tx.add(ix).sign(payer, newAccount);

        const result = svm.sendTransaction(tx);
        assert(!(result instanceof FailedTransactionMetadata), `transaction failed: ${result.toString()}`);

        assert.equal(balance(newAccount.publicKey), rentExemptBalance);
        assert.equal(balance(rentVaultPda), vaultBalanceBefore - rentExemptBalance);
    });
});
