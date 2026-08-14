export * from './create';
export * from './reallocate';

export const ReallocInstruction = {
    Create: 0,
    ReallocateWithoutZeroInit: 1,
    ReallocateZeroInit: 2,
} as const;

export type ReallocInstruction = (typeof ReallocInstruction)[keyof typeof ReallocInstruction];
