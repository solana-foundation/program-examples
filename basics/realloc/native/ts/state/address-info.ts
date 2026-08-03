import { Buffer } from 'node:buffer';
import * as borsh from 'borsh';

export const AddressInfoSchema = {
    struct: {
        name: 'string',
        house_number: 'u8',
        street: 'string',
        city: 'string',
    },
} as const;

export class AddressInfo {
    name: string;
    house_number: number;
    street: string;
    city: string;

    constructor(props: { name: string; house_number: number; street: string; city: string }) {
        this.name = props.name;
        this.house_number = props.house_number;
        this.street = props.street;
        this.city = props.city;
    }

    toBuffer() {
        return Buffer.from(borsh.serialize(AddressInfoSchema, this));
    }

    static fromBuffer(buffer: Buffer): AddressInfo {
        return borsh.deserialize(AddressInfoSchema, buffer) as AddressInfo;
    }
}
