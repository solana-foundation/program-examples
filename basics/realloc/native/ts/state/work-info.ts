import { Buffer } from "node:buffer";
import * as borsh from "borsh";

export const WorkInfoSchema = {
  struct: {
    name: "string",
    position: "string",
    company: "string",
    years_employed: "u8",
  },
} as const;

export class WorkInfo {
  name: string;
  position: string;
  company: string;
  years_employed: number;

  constructor(props: {
    name: string;
    position: string;
    company: string;
    years_employed: number;
  }) {
    this.name = props.name;
    this.position = props.position;
    this.company = props.company;
    this.years_employed = props.years_employed;
  }

  toBuffer() {
    return Buffer.from(borsh.serialize(WorkInfoSchema, this));
  }

  static fromBuffer(buffer: Buffer): WorkInfo {
    return borsh.deserialize(WorkInfoSchema, buffer) as WorkInfo;
  }
}
