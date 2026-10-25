import {
    AccountRole,
    type Address,
    getAddressEncoder,
    getBooleanEncoder,
    getStructEncoder,
    getU16Encoder,
    getU64Encoder,
    getU8Encoder,
    type Instruction,
    type TransactionSigner,
} from '@solana/kit';
import { SYSTEM_PROGRAM_ADDRESS } from '@solana-program/system';
import { ASSOCIATED_TOKEN_PROGRAM_ADDRESS, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';

export enum TokenSwapInstruction {
    CreateAmm = 0,
    CreatePool = 1,
    DepositLiquidity = 2,
    WithdrawLiquidity = 3,
    SwapExactTokensForTokens = 4,
}

const createAmmEncoder = getStructEncoder([
    ['instruction', getU8Encoder()],
    ['id', getAddressEncoder()],
    ['fee', getU16Encoder()],
]);

const createPoolEncoder = getStructEncoder([
    ['instruction', getU8Encoder()],
]);

const depositLiquidityEncoder = getStructEncoder([
    ['instruction', getU8Encoder()],
    ['amount_a', getU64Encoder()],
    ['amount_b', getU64Encoder()],
]);

const withdrawLiquidityEncoder = getStructEncoder([
    ['instruction', getU8Encoder()],
    ['amount', getU64Encoder()],
]);

const swapExactEncoder = getStructEncoder([
    ['instruction', getU8Encoder()],
    ['swap_a', getBooleanEncoder()],
    ['input_amount', getU64Encoder()],
    ['min_output_amount', getU64Encoder()],
]);

export function buildCreateAmm(props: {
    id: Address;
    fee: number;
    amm: Address;
    admin: Address;
    payer: TransactionSigner;
    programId: Address;
}): Instruction {
    const data = createAmmEncoder.encode({
        instruction: TokenSwapInstruction.CreateAmm,
        id: props.id,
        fee: props.fee,
    });

    return {
        programAddress: props.programId,
        accounts: [
            { address: props.amm, role: AccountRole.WRITABLE },
            { address: props.admin, role: AccountRole.READONLY },
            { address: props.payer.address, role: AccountRole.WRITABLE_SIGNER, signer: props.payer },
            { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
        ],
        data,
    };
}

export function buildCreatePool(props: {
    amm: Address;
    pool: Address;
    poolAuthority: Address;
    mintLiquidity: Address;
    mintA: Address;
    mintB: Address;
    poolAccountA: Address;
    poolAccountB: Address;
    payer: TransactionSigner;
    programId: Address;
}): Instruction {
    const data = createPoolEncoder.encode({
        instruction: TokenSwapInstruction.CreatePool,
    });

    return {
        programAddress: props.programId,
        accounts: [
            { address: props.amm, role: AccountRole.READONLY },
            { address: props.pool, role: AccountRole.WRITABLE },
            { address: props.poolAuthority, role: AccountRole.READONLY },
            { address: props.mintLiquidity, role: AccountRole.WRITABLE },
            { address: props.mintA, role: AccountRole.READONLY },
            { address: props.mintB, role: AccountRole.READONLY },
            { address: props.poolAccountA, role: AccountRole.WRITABLE },
            { address: props.poolAccountB, role: AccountRole.WRITABLE },
            { address: props.payer.address, role: AccountRole.WRITABLE_SIGNER, signer: props.payer },
            { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            { address: ASSOCIATED_TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
        ],
        data,
    };
}

export function buildDepositLiquidity(props: {
    pool: Address;
    poolAuthority: Address;
    depositor: TransactionSigner;
    mintLiquidity: Address;
    mintA: Address;
    mintB: Address;
    poolAccountA: Address;
    poolAccountB: Address;
    depositorAccountLiquidity: Address;
    depositorAccountA: Address;
    depositorAccountB: Address;
    payer: TransactionSigner;
    amountA: bigint;
    amountB: bigint;
    programId: Address;
}): Instruction {
    const data = depositLiquidityEncoder.encode({
        instruction: TokenSwapInstruction.DepositLiquidity,
        amount_a: props.amountA,
        amount_b: props.amountB,
    });

    return {
        programAddress: props.programId,
        accounts: [
            { address: props.pool, role: AccountRole.READONLY },
            { address: props.poolAuthority, role: AccountRole.READONLY },
            { address: props.depositor.address, role: AccountRole.WRITABLE_SIGNER, signer: props.depositor },
            { address: props.mintLiquidity, role: AccountRole.WRITABLE },
            { address: props.mintA, role: AccountRole.READONLY },
            { address: props.mintB, role: AccountRole.READONLY },
            { address: props.poolAccountA, role: AccountRole.WRITABLE },
            { address: props.poolAccountB, role: AccountRole.WRITABLE },
            { address: props.depositorAccountLiquidity, role: AccountRole.WRITABLE },
            { address: props.depositorAccountA, role: AccountRole.WRITABLE },
            { address: props.depositorAccountB, role: AccountRole.WRITABLE },
            { address: props.payer.address, role: AccountRole.WRITABLE_SIGNER, signer: props.payer },
            { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            { address: ASSOCIATED_TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
        ],
        data,
    };
}

export function buildWithdrawLiquidity(props: {
    pool: Address;
    poolAuthority: Address;
    depositor: TransactionSigner;
    mintLiquidity: Address;
    mintA: Address;
    mintB: Address;
    poolAccountA: Address;
    poolAccountB: Address;
    depositorAccountLiquidity: Address;
    depositorAccountA: Address;
    depositorAccountB: Address;
    payer: TransactionSigner;
    amount: bigint;
    programId: Address;
}): Instruction {
    const data = withdrawLiquidityEncoder.encode({
        instruction: TokenSwapInstruction.WithdrawLiquidity,
        amount: props.amount,
    });

    return {
        programAddress: props.programId,
        accounts: [
            { address: props.pool, role: AccountRole.READONLY },
            { address: props.poolAuthority, role: AccountRole.READONLY },
            { address: props.depositor.address, role: AccountRole.WRITABLE_SIGNER, signer: props.depositor },
            { address: props.mintLiquidity, role: AccountRole.WRITABLE },
            { address: props.mintA, role: AccountRole.READONLY },
            { address: props.mintB, role: AccountRole.READONLY },
            { address: props.poolAccountA, role: AccountRole.WRITABLE },
            { address: props.poolAccountB, role: AccountRole.WRITABLE },
            { address: props.depositorAccountLiquidity, role: AccountRole.WRITABLE },
            { address: props.depositorAccountA, role: AccountRole.WRITABLE },
            { address: props.depositorAccountB, role: AccountRole.WRITABLE },
            { address: props.payer.address, role: AccountRole.WRITABLE_SIGNER, signer: props.payer },
            { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            { address: ASSOCIATED_TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
        ],
        data,
    };
}

export function buildSwapExactTokensForTokens(props: {
    amm: Address;
    pool: Address;
    poolAuthority: Address;
    trader: TransactionSigner;
    mintA: Address;
    mintB: Address;
    poolAccountA: Address;
    poolAccountB: Address;
    traderAccountA: Address;
    traderAccountB: Address;
    payer: TransactionSigner;
    swapA: boolean;
    inputAmount: bigint;
    minOutputAmount: bigint;
    programId: Address;
}): Instruction {
    const data = swapExactEncoder.encode({
        instruction: TokenSwapInstruction.SwapExactTokensForTokens,
        swap_a: props.swapA,
        input_amount: props.inputAmount,
        min_output_amount: props.minOutputAmount,
    });

    return {
        programAddress: props.programId,
        accounts: [
            { address: props.amm, role: AccountRole.READONLY },
            { address: props.pool, role: AccountRole.READONLY },
            { address: props.poolAuthority, role: AccountRole.READONLY },
            { address: props.trader.address, role: AccountRole.WRITABLE_SIGNER, signer: props.trader },
            { address: props.mintA, role: AccountRole.READONLY },
            { address: props.mintB, role: AccountRole.READONLY },
            { address: props.poolAccountA, role: AccountRole.WRITABLE },
            { address: props.poolAccountB, role: AccountRole.WRITABLE },
            { address: props.traderAccountA, role: AccountRole.WRITABLE },
            { address: props.traderAccountB, role: AccountRole.WRITABLE },
            { address: props.payer.address, role: AccountRole.WRITABLE_SIGNER, signer: props.payer },
            { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            { address: ASSOCIATED_TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
        ],
        data,
    };
}
