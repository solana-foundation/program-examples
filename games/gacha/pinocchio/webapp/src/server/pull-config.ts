import 'server-only';

import { gachaProgram } from '@solana/gacha';
import {
    type Address,
    address,
    createClient,
    createKeyPairSignerFromBytes,
    type KeyPairSigner,
    type MicroLamports,
} from '@solana/kit';
import { solanaRpc } from '@solana/kit-plugin-rpc';
import { signer } from '@solana/kit-plugin-signer';

import { PullProcessError } from './pull-error';

const PRIORITY_FEE_MICRO_LAMPORTS = 1_000n as MicroLamports;

/** Validated private configuration for the pull orchestrator. */
export interface PullServerConfig {
    readonly operator: KeyPairSigner;
    /** Raw 64-byte operator secret; its first 32 bytes seed the ECVRF reveal. */
    readonly operatorSecret: Uint8Array;
    readonly poolAddress: Address;
    readonly rpcUrl: string;
}

/** Loads and validates the private devnet pull configuration. */
export async function loadPullServerConfig(): Promise<PullServerConfig> {
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
            operator: await createKeyPairSignerFromBytes(secret),
            operatorSecret: secret,
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

/** Builds the operator-signed kit client used across the pull pipeline. */
export function createPullClient(config: PullServerConfig) {
    return createClient()
        .use(signer(config.operator))
        .use(
            solanaRpc({
                rpcUrl: config.rpcUrl,
                transactionConfig: { microLamportsPerComputeUnit: PRIORITY_FEE_MICRO_LAMPORTS },
            }),
        )
        .use(gachaProgram());
}

/** The operator-signed kit client shared by validation and orchestration. */
export type PullClient = ReturnType<typeof createPullClient>;
