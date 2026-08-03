import type { NextConfig } from 'next';
import path from 'node:path';

const nextConfig: NextConfig = {
    serverExternalPackages: ['@lightprotocol/stateless.js'],
    turbopack: { root: path.resolve(import.meta.dirname, '..') },
};

export default nextConfig;
