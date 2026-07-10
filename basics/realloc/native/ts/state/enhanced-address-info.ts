import { Buffer } from "node:buffer";
import * as borsh from "borsh";

export const EnhancedAddressInfoSchema = {
  struct: {
    name: "string",
    house_number: "u8",
    street: "string",
    city: "string",
    state: "string",
    zip: "u32",
  },
} as const;

export class EnhancedAddressInfo {
  name: string;
  house_number: number;
  street: string;
  city: string;
  state: string;
  zip: number;

  constructor(props: {
    name: string;
    house_number: number;
    street: string;
    city: string;
    state: string;
    zip: number;
  }) {
    this.name = props.name;
    this.house_number = props.house_number;
    this.street = props.street;
    this.city = props.city;
    this.state = props.state;
    this.zip = props.zip;
  }

  toBuffer() {
    return Buffer.from(borsh.serialize(EnhancedAddressInfoSchema, this));
  }

  static fromBuffer(buffer: Buffer): EnhancedAddressInfo {
    return borsh.deserialize(EnhancedAddressInfoSchema, buffer) as EnhancedAddressInfo;
  }
}
