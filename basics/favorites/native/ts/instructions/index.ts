export * from './create-pda';
export * from './get-pda';

export const FavoritesInstruction = {
    CreatePda: 0,
    GetPda: 1,
} as const;

export type FavoritesInstruction = (typeof FavoritesInstruction)[keyof typeof FavoritesInstruction];
