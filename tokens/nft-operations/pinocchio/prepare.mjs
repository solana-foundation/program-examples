// Dumps the Metaplex Token Metadata program from mainnet into the bankrun
// fixtures directory so the test can load it into the local test validator.
// Runs automatically via the `postinstall` script.
//
// Uses only the Node.js standard library (no extra dependencies). Errors are
// logged but not fatal — a missing fixture will surface as a clear test failure
// when bankrun can't find `token_metadata.so`.

import { execSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const programs = [
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
        // `-um` points this one command at mainnet, where the canonical program
        // lives, without touching the developer's global Solana CLI config.
        execSync(`solana program dump -um ${id} ${outputFile}`, { stdio: 'inherit' });
        console.log(`Dumped ${id} -> ${outputFile}`);
    }
} catch (error) {
    console.error(`Failed to prepare program fixtures: ${error.message}`);
}
