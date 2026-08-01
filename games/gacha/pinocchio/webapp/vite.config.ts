import path from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
    define: {
        'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'development'),
    },
    plugins: [react()],
    resolve: {
        alias: {
            '@': path.resolve(import.meta.dirname, './src'),
        },
    },
    server: {
        proxy: {
            '/rpc': {
                changeOrigin: true,
                rewrite: p => p.replace(/^\/rpc/, ''),
                target: 'http://localhost:8899',
            },
        },
    },
});
