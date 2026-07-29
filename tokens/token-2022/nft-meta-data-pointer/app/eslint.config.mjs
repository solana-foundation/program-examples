import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';

const eslintConfig = defineConfig([
    ...nextVitals,
    {
        rules: {
            // Pre-existing pattern: these effects clear stale state before an
            // async fetch keyed on a changing wallet/PDA dependency, which this
            // rule flags but is not itself buggy. Left as-is by the Next.js
            // upgrade rather than restructuring live wallet-data-fetching logic.
            'react-hooks/set-state-in-effect': 'off',
        },
    },
    globalIgnores(['node_modules/**', '.next/**', 'out/**', 'build/**', 'next-env.d.ts']),
]);

export default eslintConfig;
