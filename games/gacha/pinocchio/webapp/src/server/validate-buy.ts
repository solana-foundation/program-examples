import 'server-only';

import { findEventAuthorityPda, findPullPda, findVaultPda, GACHA_PROGRAM_ADDRESS } from '@solana/gacha';
import {
    type Address,
    address,
    type CompiledTransactionMessage,
    getBase58Decoder,
    getCompiledTransactionMessageDecoder,
    getTransactionDecoder,
    type Signature,
    type Transaction,
} from '@solana/kit';

import type { PullClient, PullServerConfig } from './pull-config';
import { PullProcessError } from './pull-error';

const COMPUTE_BUDGET_PROGRAM = 'ComputeBudget111111111111111111111111111111';
const SYSTEM_PROGRAM = '11111111111111111111111111111111';
const MAX_TRANSACTION_BASE64_LENGTH = 4_096;

/** A validated buy transaction and the addresses derived from it. */
export interface ValidatedBuy {
    readonly buyer: Address;
    readonly pull: Address;
    readonly rawTransaction: Uint8Array;
    readonly signature: string;
}

function fail(code: string, message: string): never {
    throw new PullProcessError('validation', code, message, false);
}

/** Deserializes and allowlists a wallet-signed `buy_pull` transaction. */
export async function validateSignedBuy(
    client: PullClient,
    config: PullServerConfig,
    buyerValue: string,
    signedBuyTransaction: string,
): Promise<ValidatedBuy> {
    if (signedBuyTransaction.length === 0 || signedBuyTransaction.length > MAX_TRANSACTION_BASE64_LENGTH) {
        fail('invalid_transaction_size', 'The signed transaction has an invalid size.');
    }

    let buyer: Address;
    let rawTransaction: Uint8Array;
    let transaction: Transaction;
    let message: CompiledTransactionMessage;
    try {
        buyer = address(buyerValue);
        rawTransaction = Uint8Array.from(Buffer.from(signedBuyTransaction, 'base64'));
        transaction = getTransactionDecoder().decode(rawTransaction);
        message = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);
    } catch {
        fail('invalid_transaction', 'The signed transaction could not be decoded.');
    }

    if (message.version === 1) {
        fail('invalid_transaction', 'Version 1 transactions are not supported.');
    }
    if ('addressTableLookups' in message && (message.addressTableLookups?.length ?? 0) !== 0) {
        fail('lookup_tables_not_allowed', 'Address lookup tables are not allowed in buy transactions.');
    }
    const keys = message.staticAccounts;
    if (keys[0] !== buyer || message.header.numSignerAccounts !== 1) {
        fail('invalid_buyer', 'The connected wallet must be the only transaction signer and fee payer.');
    }
    const walletSignature = transaction.signatures[buyer];
    if (!walletSignature || walletSignature.every(byte => byte === 0)) {
        fail('missing_signature', 'The buy transaction is not signed.');
    }

    let buyInstruction: (typeof message.instructions)[number] | undefined;
    for (const instruction of message.instructions) {
        const program = keys[instruction.programAddressIndex];
        if (program === COMPUTE_BUDGET_PROGRAM) continue;
        if (program !== GACHA_PROGRAM_ADDRESS || buyInstruction) {
            fail('unexpected_instruction', 'Only compute-budget instructions and one buy_pull are allowed.');
        }
        buyInstruction = instruction;
    }
    const data = buyInstruction?.data;
    if (!buyInstruction || !data || data.length !== 33 || data[0] !== 1) {
        fail('invalid_buy_instruction', 'The transaction does not contain a valid buy_pull instruction.');
    }

    const accountIndices = buyInstruction.accountIndices ?? [];
    const accountKeys = accountIndices.map(index => keys[index]);
    const [instructionBuyer, poolKey, pullKey, vaultKey, systemKey, eventAuthorityKey, selfProgramKey] = accountKeys;
    if (
        accountKeys.length !== 7 ||
        !instructionBuyer ||
        !poolKey ||
        !pullKey ||
        !vaultKey ||
        !systemKey ||
        !eventAuthorityKey ||
        !selfProgramKey
    ) {
        fail('invalid_buy_accounts', 'The buy_pull account list is invalid.');
    }
    if (
        instructionBuyer !== buyer ||
        poolKey !== config.poolAddress ||
        systemKey !== SYSTEM_PROGRAM ||
        selfProgramKey !== GACHA_PROGRAM_ADDRESS
    ) {
        fail('invalid_buy_accounts', 'The buy_pull transaction targets unexpected accounts.');
    }

    const pool = await client.gacha.accounts.pool.fetchMaybe(config.poolAddress);
    if (!pool.exists) fail('pool_not_found', 'The configured gacha pool was not found.');
    const signature = getBase58Decoder().decode(walletSignature);
    const signatureStatus = (
        await client.rpc.getSignatureStatuses([signature as Signature], { searchTransactionHistory: true }).send()
    ).value[0];
    let expectedPull: Address;
    if (signatureStatus && !signatureStatus.err) {
        const submittedPull = await client.gacha.accounts.pull.fetchMaybe(pullKey);
        if (!submittedPull.exists) fail('pull_not_found', 'The confirmed buy pull account was not found.');
        if (
            submittedPull.data.buyer !== buyer ||
            submittedPull.data.pool !== config.poolAddress ||
            !Uint8Array.from(submittedPull.data.clientSeed).every((byte, index) => byte === data[index + 1])
        ) {
            fail('pull_mismatch', 'The confirmed pull does not match the signed buy transaction.');
        }
        expectedPull = pullKey;
    } else {
        [expectedPull] = await findPullPda({ buyer, index: pool.data.pullsCount, pool: config.poolAddress });
    }
    const [expectedVault] = await findVaultPda({ admin: pool.data.admin });
    const [expectedEventAuthority] = await findEventAuthorityPda();
    if (pullKey !== expectedPull || vaultKey !== expectedVault || eventAuthorityKey !== expectedEventAuthority) {
        fail('stale_or_invalid_pull', 'The pool changed before this pull was submitted. Please approve a new pull.');
    }

    return {
        buyer,
        pull: expectedPull,
        rawTransaction,
        signature,
    };
}
