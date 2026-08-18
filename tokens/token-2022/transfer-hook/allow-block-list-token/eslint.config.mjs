import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
    baseDirectory: __dirname,
});

const eslintConfig = [
    ...compat.extends('next/core-web-vitals', 'next/typescript'),
    {
        // Codama-generated client — regenerated on every build (`pnpm run generate-client`),
        // never hand-edited, so it's not worth linting.
        ignores: ['src/generated/**'],
    },
];

export default eslintConfig;
