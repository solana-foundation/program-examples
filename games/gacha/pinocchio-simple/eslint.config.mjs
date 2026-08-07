import solanaConfig from '@solana/eslint-config-solana';

export default [
    ...solanaConfig,
    {
        files: ['scripts/**/*.ts'],
        rules: {
            '@typescript-eslint/no-base-to-string': 'off',
            '@typescript-eslint/no-floating-promises': 'off',
            '@typescript-eslint/no-misused-promises': 'off',
            '@typescript-eslint/no-unsafe-argument': 'off',
            '@typescript-eslint/no-unsafe-assignment': 'off',
            '@typescript-eslint/no-unsafe-enum-comparison': 'off',
            '@typescript-eslint/no-unsafe-member-access': 'off',
            '@typescript-eslint/no-unsafe-return': 'off',
            '@typescript-eslint/restrict-template-expressions': 'off',
            '@typescript-eslint/unbound-method': 'off',
        },
    },
    {
        ignores: [
            '**/.claude/**',
            '**/.remember/**',
            '**/.git/**',
            '**/dist/**',
            '**/node_modules/**',
            '**/target/**',
            '**/generated/**',
            'clients/typescript/src/generated/**',
            'clients/typescript/test/**',
            'clients/typescript/*.config.ts',
            'eslint.config.mjs',
            '**/*.mjs',
        ],
    },
];
