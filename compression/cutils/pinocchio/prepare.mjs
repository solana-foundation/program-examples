// Dumps the programs a compressed-NFT mint touches from mainnet into the test
// fixtures directory, so LiteSVM can load them. Runs automatically via the
// `postinstall` script.
//
// Uses only the Node.js standard library (no extra dependencies). Errors are
// logged but not fatal — a missing fixture will surface as a clear test failure
// when LiteSVM can't find the .so.

import { execSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const programs = [
    {
        id: 'BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY',
        name: 'mpl_bubblegum.so',
    },
    {
        id: 'cmtDvXumGCrqC1Age74AVPhSRVXJMd8PJS91L8KbNCK',
        name: 'spl_account_compression.so',
    },
    {
        id: 'noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV',
        name: 'spl_noop.so',
    },
    {
        id: 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s',
        name: 'token_metadata.so',
    },
];

const outputDir = 'tests/fixtures';

try {
    mkdirSync(outputDir, { recursive: true });

    for (const { id, name } of programs) {
        const outputFile = join(outputDir, name);
        rmSync(outputFile, { force: true });
        // `-um` points this one command at mainnet, where the canonical programs
        // live, without touching the developer's global Solana CLI config.
        execSync(`solana program dump -um ${id} ${outputFile}`, { stdio: 'inherit' });
        console.log(`Dumped ${id} -> ${outputFile}`);
    }
} catch (error) {
    console.error(`Failed to prepare program fixtures: ${error.message}`);
}
