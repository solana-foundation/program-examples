export * from './create';
export * from './mint-nft';
export * from './mint-spl';
export * from './transfer';

export const MyInstruction = {
    Create: 0,
    MintNft: 1,
    MintSpl: 2,
    TransferTokens: 3,
} as const;

export type MyInstruction = (typeof MyInstruction)[keyof typeof MyInstruction];
