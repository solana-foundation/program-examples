import type { Program } from '@anchor-lang/core';
import * as anchor from '@anchor-lang/core';
import type { AblToken } from '../target/types/abl_token';

describe('abl-token', () => {
    // Configure the client to use the local cluster.
    anchor.setProvider(anchor.AnchorProvider.env());

    const _program = anchor.workspace.ABLToken as Program<AblToken>;

    it('should run the program', async () => {
        // Add your test here.
    });
});
