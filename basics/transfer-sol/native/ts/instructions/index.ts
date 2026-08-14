export * from './transfer';

export const TransferInstruction = {
    CpiTransfer: 0,
    ProgramTransfer: 1,
} as const;

export type TransferInstruction = (typeof TransferInstruction)[keyof typeof TransferInstruction];
