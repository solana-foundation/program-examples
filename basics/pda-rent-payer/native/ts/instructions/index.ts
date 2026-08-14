export * from './create-new-account';
export * from './init-rent-vault';

export const MyInstruction = {
    InitRentVault: 0,
    CreateNewAccount: 1,
} as const;

export type MyInstruction = (typeof MyInstruction)[keyof typeof MyInstruction];
