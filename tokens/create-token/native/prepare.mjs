#!/usr/bin/env zx

import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { $ } from 'zx';

const programs = [
    {
        id: 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s',
        name: 'token_metadata.so',
    },
];

const outputDir = 'tests/fixtures';
const overwrite = true;

try {
    for (const program of programs) {
        const { id, name } = program;
        const outputFile = join(outputDir, name);
        try {
            await mkdir(outputDir, { recursive: true });
            if (overwrite) await rm(outputFile, { force: true });
            // `-um` targets mainnet for this command only, leaving the developer's
            // global Solana CLI config alone.
            await $`solana program dump -um ${id} ${outputFile}`;
            console.log(`Program ${id} dumped to ${outputFile}`);
        } catch (error) {
            console.error(`Error dumping ${id}: ${error.message}`);
        }
    }
} catch (error) {
    console.error(`Error preparing programs: ${error.message}`);
}
