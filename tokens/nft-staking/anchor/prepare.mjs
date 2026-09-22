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

// The cluster is passed per command rather than via `solana config set`, so
// installing this example never changes the machine's default cluster.
const cluster = 'https://api.mainnet-beta.solana.com';

for (const { id, name } of programs) {
    const outputFile = join(outputDir, name);

    await mkdir(outputDir, { recursive: true });
    await rm(outputFile, { force: true });

    // No try/catch: the tests load these fixtures unconditionally, so a failed
    // dump has to fail the install rather than surface later as litesvm
    // refusing to open a missing file.
    await $`solana program dump ${id} ${outputFile} --url ${cluster}`;
    console.log(`Program ${id} dumped to ${outputFile}`);
}
