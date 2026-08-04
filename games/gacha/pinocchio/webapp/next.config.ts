import path from 'node:path';

import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
    serverExternalPackages: ['@lightprotocol/stateless.js'],
    turbopack: { root: path.resolve(import.meta.dirname, '..') },
};

export default nextConfig;
