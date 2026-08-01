import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';

/** Loads the webapp's local RPC configuration without overriding explicit shell values. */
export function loadWebappEnv(): void {
    const envPath = resolve(process.cwd(), 'webapp/.env.local');
    if (!existsSync(envPath)) return;

    const rpcUrl = process.env.RPC_URL;
    const viteDevnetRpcUrl = process.env.VITE_DEVNET_RPC_URL;
    loadEnvFile(envPath);

    if (rpcUrl !== undefined) process.env.RPC_URL = rpcUrl;
    if (viteDevnetRpcUrl !== undefined) process.env.VITE_DEVNET_RPC_URL = viteDevnetRpcUrl;
}
