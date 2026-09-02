// Dumps the SOL/USD `PriceUpdateV2` account from mainnet into the test fixtures
// directory, so the suite can read a real price feed alongside its mock ones.
// Runs automatically via the `postinstall` script.
//
// Uses only the Node.js standard library (no extra dependencies). Errors are
// logged but not fatal — a missing fixture will surface as a clear test failure.

import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const PRICE_UPDATE_ACCOUNT = '7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE';
const outputFile = 'tests/fixtures/sol_usd_price_update.json';

try {
    mkdirSync('tests/fixtures', { recursive: true });
    // `-um` points this one command at mainnet, where the price feeds live,
    // without touching the developer's global Solana CLI config.
    execSync(`solana account ${PRICE_UPDATE_ACCOUNT} -um --output json --output-file ${outputFile}`, {
        stdio: 'inherit',
    });
    console.log(`Price update account dumped to ${outputFile}`);
} catch (error) {
    console.error(`Failed to prepare the price feed fixture: ${error.message}`);
}
