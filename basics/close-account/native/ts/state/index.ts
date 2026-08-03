import { Buffer } from 'node:buffer';
import * as borsh from 'borsh';

export class User {
    name: string;

    constructor(props: { name: string }) {
        this.name = props.name;
    }

    toBase58() {
        return borsh.serialize(UserSchema, this).toString();
    }

    toBuffer() {
        return Buffer.from(borsh.serialize(UserSchema, this));
    }

    static fromBuffer(buffer: Buffer) {
        return borsh.deserialize(UserSchema, User, buffer);
    }
}

export const UserSchema = new Map([
    [
        User,
        {
            kind: 'struct',
            fields: [['name', 'string']],
        },
    ],
]);
