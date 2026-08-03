#!/usr/bin/env zx

import { mkdir } from 'node:fs/promises';
import { $ } from 'zx';

const PRICE_UPDATE_ACCOUNT = '7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE';
const outputFile = 'tests/fixtures/sol_usd_price_update.json';

await mkdir('tests/fixtures', { recursive: true });
await $`solana account ${PRICE_UPDATE_ACCOUNT} -um --output json --output-file ${outputFile}`;
console.log(`Price update account dumped to ${outputFile}`);
