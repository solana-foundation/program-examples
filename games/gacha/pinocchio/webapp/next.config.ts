import type { NextConfig } from 'next';
import path from 'node:path';

const nextConfig: NextConfig = {
    serverExternalPackages: [
        '@collectorcrypt/vrf-client',
        '@coral-xyz/anchor',
        '@lightprotocol/stateless.js',
        '@solana/web3.js',
    ],
    turbopack: { root: path.resolve(import.meta.dirname, '..') },
};

export default nextConfig;
