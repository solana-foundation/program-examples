import 'server-only';

import { type Address, address } from '@solana/kit';
import { Keypair, PublicKey } from '@solana/web3.js';

import { PullProcessError } from './pull-error';

/** Validated private configuration for the pull orchestrator. */
export interface PullServerConfig {
    readonly operator: Keypair;
    readonly pool: PublicKey;
    readonly poolAddress: Address;
    readonly rpcUrl: string;
}

/** Loads and validates the private devnet pull configuration. */
export function loadPullServerConfig(): PullServerConfig {
    const rpcUrl = process.env.SOLANA_RPC_URL?.trim();
    const poolValue = process.env.GACHA_POOL_ADDRESS?.trim();
    const keypairValue = process.env.OPERATOR_KEYPAIR_BASE64?.trim();
    if (!rpcUrl || !poolValue || !keypairValue) {
        throw new PullProcessError(
            'request',
            'server_not_configured',
            'The devnet pull service is not configured.',
            false,
        );
    }

    let secret: Uint8Array;
    try {
        secret = Uint8Array.from(Buffer.from(keypairValue, 'base64'));
    } catch {
        throw new PullProcessError('request', 'invalid_operator_key', 'The operator key is invalid.', false);
    }
    if (secret.length !== 64) {
        throw new PullProcessError(
            'request',
            'invalid_operator_key',
            'The operator key must decode to 64 bytes.',
            false,
        );
    }

    try {
        return {
            operator: Keypair.fromSecretKey(secret),
            pool: new PublicKey(poolValue),
            poolAddress: address(poolValue),
            rpcUrl,
        };
    } catch {
        throw new PullProcessError(
            'request',
            'invalid_server_config',
            'The pull service configuration is invalid.',
            false,
        );
    }
}
