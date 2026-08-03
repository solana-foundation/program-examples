import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['src/index.ts', 'src/reveal-context.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    clean: true,
    splitting: false,
    sourcemap: true,
    shims: true,
});
