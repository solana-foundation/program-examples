export * from "./close";
export * from "./create";

export const MyInstruction = {
  CreateUser: 0,
  CloseUser: 1,
} as const;

export type MyInstruction = (typeof MyInstruction)[keyof typeof MyInstruction];
