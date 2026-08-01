import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
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
