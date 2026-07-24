import solanaConfig from '@solana/eslint-config-solana';
import reactHooksPlugin from 'eslint-plugin-react-hooks';

export default [
    ...solanaConfig,
    {
        files: ['webapp/src/**/*.{ts,tsx}'],
        plugins: {
            'react-hooks': reactHooksPlugin,
        },
        rules: {
            ...reactHooksPlugin.configs.recommended.rules,
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
            'webapp/api/**',
            'webapp/scripts/**',
            'webapp/test/**',
            'webapp/*.config.js',
            '**/playwright-report/**',
            '**/test-results/**',
            'eslint.config.mjs',
            '**/*.mjs',
        ],
    },
];
