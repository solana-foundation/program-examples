export * from './create';
export * from './init';
export * from './mint';

export const MyInstruction = {
    Init: 0,
    Create: 1,
    Mint: 2,
} as const;

export type MyInstruction = (typeof MyInstruction)[keyof typeof MyInstruction];
