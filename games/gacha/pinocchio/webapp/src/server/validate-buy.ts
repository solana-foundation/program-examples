import 'server-only';

import {
    findEventAuthorityPda,
    findPullPda,
    findVaultPda,
    GACHA_PROGRAM_ADDRESS,
    getPoolDecoder,
    getPullDecoder,
} from '@solana/gacha';
import { type Address, address, getBase58Decoder } from '@solana/kit';
import { Connection, PublicKey, SystemProgram, VersionedTransaction } from '@solana/web3.js';

import type { PullServerConfig } from './pull-config';
import { PullProcessError } from './pull-error';

const COMPUTE_BUDGET_PROGRAM = 'ComputeBudget111111111111111111111111111111';
const MAX_TRANSACTION_BASE64_LENGTH = 4_096;

/** A validated buy transaction and the addresses derived from it. */
export interface ValidatedBuy {
    readonly buyer: Address;
    readonly pull: Address;
    readonly rawTransaction: Uint8Array;
    readonly signature: string;
    readonly transaction: VersionedTransaction;
}

function fail(code: string, message: string): never {
    throw new PullProcessError('validation', code, message, false);
}

/** Deserializes and allowlists a wallet-signed `buy_pull` transaction. */
export async function validateSignedBuy(
    connection: Connection,
    config: PullServerConfig,
    buyerValue: string,
    signedBuyTransaction: string,
): Promise<ValidatedBuy> {
    if (signedBuyTransaction.length === 0 || signedBuyTransaction.length > MAX_TRANSACTION_BASE64_LENGTH) {
        fail('invalid_transaction_size', 'The signed transaction has an invalid size.');
    }

    let buyer: Address;
    let transaction: VersionedTransaction;
    let rawTransaction: Uint8Array;
    try {
        buyer = address(buyerValue);
        rawTransaction = Uint8Array.from(Buffer.from(signedBuyTransaction, 'base64'));
        transaction = VersionedTransaction.deserialize(rawTransaction);
    } catch {
        fail('invalid_transaction', 'The signed transaction could not be decoded.');
    }

    if (transaction.message.addressTableLookups.length !== 0) {
        fail('lookup_tables_not_allowed', 'Address lookup tables are not allowed in buy transactions.');
    }
    const keys = transaction.message.staticAccountKeys;
    const buyerKey = new PublicKey(buyer);
    if (!keys[0]?.equals(buyerKey) || transaction.message.header.numRequiredSignatures !== 1) {
        fail('invalid_buyer', 'The connected wallet must be the only transaction signer and fee payer.');
    }
    const walletSignature = transaction.signatures[0];
    if (!walletSignature || walletSignature.every(byte => byte === 0)) {
        fail('missing_signature', 'The buy transaction is not signed.');
    }

    let buyInstruction: (typeof transaction.message.compiledInstructions)[number] | undefined;
    for (const instruction of transaction.message.compiledInstructions) {
        const program = keys[instruction.programIdIndex]?.toBase58();
        if (program === COMPUTE_BUDGET_PROGRAM) continue;
        if (program !== GACHA_PROGRAM_ADDRESS || buyInstruction) {
            fail('unexpected_instruction', 'Only compute-budget instructions and one buy_pull are allowed.');
        }
        buyInstruction = instruction;
    }
    if (!buyInstruction || buyInstruction.data.length !== 33 || buyInstruction.data[0] !== 1) {
        fail('invalid_buy_instruction', 'The transaction does not contain a valid buy_pull instruction.');
    }

    const accountKeys = Array.from(buyInstruction.accountKeyIndexes, index => keys[index]);
    if (accountKeys.length !== 7 || accountKeys.some(key => !key)) {
        fail('invalid_buy_accounts', 'The buy_pull account list is invalid.');
    }
    const [instructionBuyer, poolKey, pullKey, vaultKey, systemKey, eventAuthorityKey, selfProgramKey] = accountKeys;
    if (
        !instructionBuyer?.equals(buyerKey) ||
        !poolKey?.equals(config.pool) ||
        !systemKey?.equals(SystemProgram.programId) ||
        selfProgramKey?.toBase58() !== GACHA_PROGRAM_ADDRESS
    ) {
        fail('invalid_buy_accounts', 'The buy_pull transaction targets unexpected accounts.');
    }

    const poolInfo = await connection.getAccountInfo(config.pool, 'confirmed');
    if (!poolInfo) fail('pool_not_found', 'The configured gacha pool was not found.');
    const pool = getPoolDecoder().decode(new Uint8Array(poolInfo.data));
    const signature = getBase58Decoder().decode(walletSignature);
    const signatureStatus = (await connection.getSignatureStatuses([signature], { searchTransactionHistory: true }))
        .value[0];
    let expectedPull: Address;
    if (signatureStatus && !signatureStatus.err) {
        const submittedPull = pullKey
            ? address(pullKey.toBase58())
            : fail('invalid_buy_accounts', 'The pull account is missing.');
        const submittedPullInfo = await connection.getAccountInfo(new PublicKey(submittedPull), 'confirmed');
        if (!submittedPullInfo) fail('pull_not_found', 'The confirmed buy pull account was not found.');
        const submittedPullData = getPullDecoder().decode(new Uint8Array(submittedPullInfo.data));
        if (
            submittedPullData.buyer !== buyer ||
            submittedPullData.pool !== config.poolAddress ||
            !Uint8Array.from(submittedPullData.clientSeed).every(
                (byte, index) => byte === buyInstruction.data[index + 1],
            )
        ) {
            fail('pull_mismatch', 'The confirmed pull does not match the signed buy transaction.');
        }
        expectedPull = submittedPull;
    } else {
        [expectedPull] = await findPullPda({ buyer, index: pool.pullsCount, pool: config.poolAddress });
    }
    const [expectedVault] = await findVaultPda({ admin: pool.admin });
    const [expectedEventAuthority] = await findEventAuthorityPda();
    if (
        pullKey?.toBase58() !== expectedPull ||
        vaultKey?.toBase58() !== expectedVault ||
        eventAuthorityKey?.toBase58() !== expectedEventAuthority
    ) {
        fail('stale_or_invalid_pull', 'The pool changed before this pull was submitted. Please approve a new pull.');
    }

    return {
        buyer,
        pull: expectedPull,
        rawTransaction,
        signature,
        transaction,
    };
}
