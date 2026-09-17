import { spawn, type ChildProcess } from 'child_process';
import { createServer } from 'node:http';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile, stat } from 'fs/promises';
import crypto from 'node:crypto';
import { checkProgramStatus } from './lib/program-status.js';
import { buildDeployPlan, buildUpgradePlan } from './lib/deploy-builder.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '../..');

const PORT = 3001;
const HOST = process.env.API_HOST?.trim() || '127.0.0.1';
const RPC_URL = process.env.RPC_URL ?? 'http://127.0.0.1:8899';
const CONFIG_PATH = join(__dirname, '../config.json');

let surfpoolProcess: ChildProcess | null = null;
let startingValidator = false;
let deployingProgram = false;

const MIN_SOL_AIRDROP = 0.1;
const MAX_SOL_AIRDROP = 10;

const SO_PATH = join(__dirname, '../../target/deploy/world_cup_program.so');

const PROGRAM_ADDRESS = 'wCupoZtR1g1NXRRVELe5KqFgayyEteVKKxEerxugvxA';

interface TokenEntry {
    symbol: string;
    mint: string;
    decimals: number;
}

interface NetworkConfig {
    programAddress?: string;
    tokens: TokenEntry[];
}

interface Config {
    networks: Record<string, NetworkConfig>;
}

function networkFromRpcUrl(rpcUrl: string): string {
    if (rpcUrl.includes('devnet')) return 'devnet';
    if (rpcUrl.includes('testnet')) return 'testnet';
    if (rpcUrl.includes('mainnet')) return 'mainnet';
    return 'localnet';
}

function getNetworkTokens(config: Config, network: string): TokenEntry[] {
    return config.networks[network]?.tokens ?? [];
}

function log(level: 'info' | 'warn' | 'error', message: string, meta?: Record<string, unknown>) {
    const timestamp = new Date().toISOString();
    const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
    console.log(`[${timestamp}] ${level.toUpperCase()}: ${message}${metaStr}`);
}

function errorMessage(error: unknown): string {
    if (error instanceof Error && 'code' in error && typeof error.code === 'string') {
        return error.code;
    }
    return error instanceof Error ? error.message : String(error);
}

async function readConfig(): Promise<Config> {
    try {
        const content = await readFile(CONFIG_PATH, 'utf-8');
        const raw = JSON.parse(content);
        if ('networks' in raw && typeof raw.networks === 'object') {
            return raw as Config;
        }
        const network = (raw.network as string) ?? 'localnet';
        const tokens = (raw.tokens as TokenEntry[]) ?? [];
        return { networks: { [network]: { tokens } } };
    } catch (error) {
        log('warn', 'Failed to read config, using defaults', { error: String(error), path: CONFIG_PATH });
        return { networks: {} };
    }
}

const ALLOWED_RPC_HOSTS = ['127.0.0.1', 'localhost', 'api.devnet.solana.com', 'api.testnet.solana.com'];

const ALLOWED_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:4173'];

function corsHeaders(origin?: string | null) {
    const allowedOrigin = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
    return {
        'Access-Control-Allow-Origin': allowedOrigin,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    };
}

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function jsonResponse(data: unknown, status = 200, origin?: string | null) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
    });
}

async function handleSolAirdrop(recipient: string, amount: number): Promise<Response> {
    if (!recipient || !BASE58_RE.test(recipient)) {
        return jsonResponse({ error: 'Invalid recipient address' }, 400);
    }
    if (!amount || !Number.isFinite(amount) || amount < MIN_SOL_AIRDROP || amount > MAX_SOL_AIRDROP) {
        return jsonResponse(
            { error: `Invalid parameters. Amount must be between ${MIN_SOL_AIRDROP} and ${MAX_SOL_AIRDROP}` },
            400,
        );
    }

    log('info', 'SOL airdrop requested', { recipient, amount });

    return new Promise(resolve => {
        const child = spawn('solana', ['airdrop', String(amount), recipient, '--url', RPC_URL]);

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', data => (stdout += data.toString()));
        child.stderr.on('data', data => (stderr += data.toString()));

        child.on('close', code => {
            if (code !== 0) {
                resolve(jsonResponse({ error: 'Failed to airdrop SOL', details: stderr }, 500));
                return;
            }
            resolve(
                jsonResponse({
                    success: true,
                    message: `Successfully airdropped ${amount} SOL to ${recipient}`,
                    recipient,
                    amount,
                }),
            );
        });

        child.on('error', err => {
            resolve(jsonResponse({ error: 'Failed to start airdrop process', details: err.message }, 500));
        });
    });
}

async function handleUsdcAirdrop(recipient: string, amount: number): Promise<Response> {
    if (!recipient || !BASE58_RE.test(recipient)) {
        return jsonResponse({ error: 'Invalid recipient address' }, 400);
    }
    if (!amount || amount <= 0) {
        return jsonResponse({ error: 'Invalid parameters' }, 400);
    }

    const config = await readConfig();
    const network = networkFromRpcUrl(RPC_URL);
    const tokens = getNetworkTokens(config, network);
    const usdcMint = tokens.find(t => t.symbol === 'USDC')?.mint;
    if (!usdcMint) {
        return jsonResponse({ error: 'USDC mint not configured. Run init-test-environment.ts first.' }, 500);
    }

    log('info', 'USDC airdrop requested', { recipient, amount, mint: usdcMint });

    return new Promise(resolve => {
        const scriptPath = join(__dirname, '../scripts/mint-usdc.ts');
        const child = spawn('tsx', [scriptPath, recipient, String(amount)], {
            env: { ...process.env, RPC_URL },
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', data => (stdout += data.toString()));
        child.stderr.on('data', data => (stderr += data.toString()));

        child.on('close', code => {
            if (code !== 0) {
                resolve(jsonResponse({ error: 'Failed to mint USDC', details: stderr || stdout }, 500));
                return;
            }
            resolve(
                jsonResponse({
                    success: true,
                    message: `Successfully minted ${amount} USDC to ${recipient}`,
                    recipient,
                    amount,
                    mint: usdcMint,
                }),
            );
        });

        child.on('error', err => {
            resolve(jsonResponse({ error: 'Failed to start minting process', details: err.message }, 500));
        });
    });
}

async function parseJsonBody(
    req: Request,
): Promise<{ success: true; data: unknown } | { success: false; error: string }> {
    try {
        const data = await req.json();
        return { success: true, data };
    } catch {
        return { success: false, error: 'Invalid JSON body' };
    }
}

function extractFields<T extends Record<string, unknown>>(
    data: unknown,
    schema: Record<
        keyof T,
        | 'string'
        | 'number'
        | 'boolean'
        | 'object'
        | 'optional_string'
        | 'optional_number'
        | 'optional_boolean'
        | 'optional_object'
    >,
): T {
    if (typeof data !== 'object' || data === null) throw new Error('Expected object');
    const obj = data as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [key, type] of Object.entries(schema)) {
        const val = obj[key];
        const isOptional = type.startsWith('optional_');
        const baseType = isOptional ? type.replace('optional_', '') : type;
        if (val === undefined || val === null) {
            if (!isOptional) throw new Error(`Missing required field: ${key}`);
            result[key] = undefined;
            continue;
        }
        if (typeof val !== baseType) throw new Error(`Field ${key} must be ${baseType}, got ${typeof val}`);
        result[key] = val;
    }
    return result as T;
}

async function handleProgramStatus(rpcUrl: string, programAddr: string): Promise<Response> {
    try {
        const status = await checkProgramStatus(rpcUrl, programAddr);
        return jsonResponse(status);
    } catch (error) {
        return jsonResponse({ error: 'Failed to check program status', details: errorMessage(error) }, 500);
    }
}

async function handleBinaryInfo(): Promise<Response> {
    try {
        const soBytes = await readFile(SO_PATH);
        const hash = crypto.createHash('sha256').update(soBytes).digest('hex');
        const fileStats = await stat(SO_PATH);
        return jsonResponse({ hash, size: fileStats.size });
    } catch (error) {
        return jsonResponse({ error: 'Binary not found', details: errorMessage(error) }, 404);
    }
}

async function handlePrepareDeploy(body: {
    isUpgrade?: boolean;
    programAddress?: string;
    rpcUrl?: string;
}): Promise<Response> {
    const { isUpgrade, programAddress, rpcUrl } = body;

    try {
        const soBytes = await readFile(SO_PATH);

        let plan;
        if (isUpgrade) {
            const config = await readConfig();
            const network = networkFromRpcUrl(rpcUrl ?? RPC_URL);
            const programAddr = config.networks[network]?.programAddress ?? PROGRAM_ADDRESS;
            plan = await buildUpgradePlan(soBytes, programAddr);
        } else {
            if (!programAddress || !BASE58_RE.test(programAddress)) {
                return jsonResponse({ error: 'Program address required for initial deploy' }, 400);
            }
            plan = await buildDeployPlan(soBytes, programAddress);
        }

        return jsonResponse(plan);
    } catch (error) {
        log('error', 'Failed to prepare deploy', { error: String(error) });
        return jsonResponse({ error: 'Failed to prepare deploy', details: errorMessage(error) }, 500);
    }
}

async function handleStartValidator(): Promise<Response> {
    if (startingValidator) {
        return jsonResponse({ success: true, alreadyStarting: true });
    }
    if (surfpoolProcess && !surfpoolProcess.killed) {
        return jsonResponse({ success: true, pid: surfpoolProcess.pid, alreadyRunning: true });
    }

    try {
        const healthRes = await fetch('http://127.0.0.1:8899', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' }),
            signal: AbortSignal.timeout(10_000),
        });
        const healthJson = (await healthRes.json()) as { result?: string };
        if (healthJson.result === 'ok') {
            return jsonResponse({ success: true, alreadyRunning: true });
        }
    } catch {
        // not running, proceed to start
    }

    startingValidator = true;
    return new Promise(resolve => {
        // Use the surfnet-setup runbook so the program is installed at its
        // canonical address (no keypair required) on a fresh validator.
        const child = spawn(
            'surfpool',
            ['start', '--no-tui', '--port', '8899', '--offline', '--yes', '--runbook', 'surfnet-setup'],
            {
                cwd: PROJECT_ROOT,
                stdio: ['ignore', 'pipe', 'pipe'],
                detached: false,
            },
        );

        surfpoolProcess = child;
        child.stdout?.on('data', d => log('info', `[surfpool] ${d.toString().trim()}`));
        child.stderr?.on('data', d => log('warn', `[surfpool] ${d.toString().trim()}`));
        child.on('exit', code => {
            log('info', `Surfpool exited with code ${code}`);
            surfpoolProcess = null;
            startingValidator = false;
        });
        child.on('error', err => {
            log('error', 'Failed to start surfpool', { error: err.message });
            surfpoolProcess = null;
            startingValidator = false;
        });

        resolve(jsonResponse({ success: true, pid: child.pid }));
    });
}

async function deployProgramViaSurfnet(): Promise<boolean> {
    if (deployingProgram) return false;
    deployingProgram = true;
    try {
        const soBytes = await readFile(SO_PATH);
        const hexData = soBytes.toString('hex');
        log('info', 'Deploying program via surfnet_writeProgram fallback', { size: soBytes.length });

        const res = await fetch('http://127.0.0.1:8899', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'surfnet_writeProgram',
                params: [PROGRAM_ADDRESS, hexData, 0],
            }),
            signal: AbortSignal.timeout(30_000),
        });
        const json = (await res.json()) as { result?: unknown; error?: { message?: string } };
        if (json.error) {
            log('error', 'surfnet_writeProgram failed', { error: json.error.message });
            return false;
        }
        log('info', 'Program deployed via surfnet_writeProgram');

        // Register IDL if available
        const IDL_PATH = join(__dirname, '../../idl/world_cup.json');
        try {
            const idlJson = JSON.parse(await readFile(IDL_PATH, 'utf-8'));
            // surfnet_registerIdl expects an 'address' field at the top level
            if (!idlJson.address) {
                idlJson.address = PROGRAM_ADDRESS;
            }
            const idlRes = await fetch('http://127.0.0.1:8899', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'surfnet_registerIdl',
                    params: [idlJson],
                }),
                signal: AbortSignal.timeout(10_000),
            });
            const idlResult = (await idlRes.json()) as { result?: unknown; error?: { message?: string } };
            if (idlResult.error) {
                log('error', 'surfnet_registerIdl failed', { error: idlResult.error.message });
            } else {
                log('info', 'IDL registered via surfnet_registerIdl');
            }
        } catch (err) {
            log('info', 'IDL registration skipped (file not found or RPC error)', { error: String(err) });
        }

        return true;
    } catch (err) {
        log('error', 'Fallback program deploy failed', { error: String(err) });
        return false;
    } finally {
        deployingProgram = false;
    }
}

async function handleValidatorStatus(): Promise<Response> {
    let validatorRunning = false;
    let programDeployed = false;
    const programAddress = PROGRAM_ADDRESS;

    try {
        const healthRes = await fetch('http://127.0.0.1:8899', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' }),
            signal: AbortSignal.timeout(10_000),
        });
        const healthJson = (await healthRes.json()) as { result?: string };
        validatorRunning = healthJson.result === 'ok';
    } catch (err) {
        log('info', 'Validator health check failed', { error: String(err) });
    }

    if (validatorRunning) {
        try {
            const acctRes = await fetch('http://127.0.0.1:8899', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'getAccountInfo',
                    params: [programAddress, { encoding: 'base64' }],
                }),
                signal: AbortSignal.timeout(10_000),
            });
            const acctJson = (await acctRes.json()) as { result?: { value?: { executable?: boolean } } };
            programDeployed = acctJson.result?.value?.executable === true;

            // Fallback: if runbook didn't deploy, kick off RPC cheatcode deploy
            // without blocking status response. Next poll will see executable=true.
            if (!programDeployed && !deployingProgram) {
                void deployProgramViaSurfnet();
            }

            if (programDeployed) {
                const config = await readConfig();
                if (config.networks['localnet']?.programAddress !== programAddress) {
                    if (!config.networks['localnet']) config.networks['localnet'] = { tokens: [] };
                    config.networks['localnet'].programAddress = programAddress;
                    await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
                    log('info', 'Updated localnet programAddress in config', { programAddress });
                }
            }
        } catch (err) {
            log('info', 'Program account check failed', { error: String(err) });
        }
    }

    return jsonResponse({ validatorRunning, programDeployed, programAddress });
}

async function handleCreateMockUsdc(): Promise<Response> {
    try {
        const config = await readConfig();
        const localTokens = getNetworkTokens(config, 'localnet');
        const existingMint = localTokens.find(t => t.symbol === 'USDC')?.mint;

        if (existingMint) {
            try {
                const acctRes = await fetch('http://127.0.0.1:8899', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        jsonrpc: '2.0',
                        id: 1,
                        method: 'getAccountInfo',
                        params: [existingMint, { encoding: 'base64' }],
                    }),
                    signal: AbortSignal.timeout(10_000),
                });
                const acctJson = (await acctRes.json()) as { result?: { value?: unknown } };
                if (acctJson.result?.value) {
                    return jsonResponse({ mint: existingMint, alreadyExisted: true });
                }
            } catch (err) {
                log('info', 'Existing USDC mint check failed', { error: String(err) });
            }
        }

        return new Promise(resolve => {
            const child = spawn('spl-token', [
                'create-token',
                '--decimals',
                '6',
                '--program-id',
                'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
                '--url',
                'http://127.0.0.1:8899',
                '--fee-payer',
                `${process.env.HOME}/.config/solana/id.json`,
            ]);

            let stdout = '';
            let stderr = '';
            child.stdout.on('data', d => (stdout += d.toString()));
            child.stderr.on('data', d => (stderr += d.toString()));

            child.on('close', async code => {
                if (code !== 0) {
                    resolve(jsonResponse({ error: 'Failed to create token', details: stderr || stdout }, 500));
                    return;
                }

                const match = stdout.match(/Creating token ([A-Za-z0-9]+)/);
                if (!match) {
                    resolve(jsonResponse({ error: 'Could not parse mint address', details: stdout }, 500));
                    return;
                }

                const mint = match[1];

                try {
                    const cfg = await readConfig();
                    if (!cfg.networks['localnet']) cfg.networks['localnet'] = { tokens: [] };
                    cfg.networks['localnet'].programAddress =
                        cfg.networks['localnet'].programAddress ?? PROGRAM_ADDRESS;
                    const tokens = cfg.networks['localnet'].tokens;
                    const usdcIdx = tokens.findIndex(t => t.symbol === 'USDC');
                    const usdcToken = { symbol: 'USDC', mint, decimals: 6 };
                    if (usdcIdx >= 0) tokens[usdcIdx] = usdcToken;
                    else tokens.push(usdcToken);
                    await writeFile(CONFIG_PATH, JSON.stringify(cfg, null, 2));
                } catch (e) {
                    log('warn', 'Failed to update config after USDC creation', { error: String(e) });
                }

                resolve(jsonResponse({ mint, alreadyExisted: false }));
            });

            child.on('error', err => {
                resolve(jsonResponse({ error: 'Failed to start spl-token', details: err.message }, 500));
            });
        });
    } catch (error) {
        return jsonResponse({ error: 'Failed to create mock USDC', details: errorMessage(error) }, 500);
    }
}

async function handleSaveConfig(body: {
    network?: string;
    programAddress?: string;
    tokens?: Array<{ symbol: string; mint: string; decimals: number }>;
}): Promise<Response> {
    try {
        const network = body.network ?? networkFromRpcUrl(RPC_URL);
        const existing = await readConfig();
        const prev = existing.networks[network] ?? { tokens: [] };
        if (body.tokens) {
            prev.tokens = body.tokens;
        }
        if (body.programAddress) {
            prev.programAddress = body.programAddress;
        }
        existing.networks[network] = prev;
        await writeFile(CONFIG_PATH, JSON.stringify(existing, null, 2));
        return jsonResponse({ success: true });
    } catch (error) {
        return jsonResponse({ error: 'Failed to save config', details: errorMessage(error) }, 500);
    }
}

async function handleRequest(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const startTime = Date.now();
    const origin = req.headers.get('origin');

    if (req.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders(origin) });
    }

    let response: Response;

    if (url.pathname === '/api/health') {
        response = jsonResponse({ status: 'ok' });
    } else if (url.pathname === '/api/config' && req.method === 'GET') {
        const config = await readConfig();
        response = jsonResponse(config);
    } else if (url.pathname === '/api/tokens' && req.method === 'GET') {
        const network = url.searchParams.get('network');
        if (!network) {
            response = jsonResponse({ error: 'Missing required query param: network' }, 400);
        } else {
            const config = await readConfig();
            const netConfig = config.networks[network];
            response = jsonResponse({
                programAddress: netConfig?.programAddress ?? null,
                tokens: netConfig?.tokens ?? [],
            });
        }
    } else if (url.pathname === '/api/airdrop/sol' && req.method === 'POST') {
        const parseResult = await parseJsonBody(req);
        if (!parseResult.success) {
            response = jsonResponse({ error: parseResult.error }, 400);
        } else {
            const body = extractFields<{ recipient?: string; amount?: number }>(parseResult.data, {
                recipient: 'optional_string',
                amount: 'optional_number',
            });
            response = await handleSolAirdrop(body.recipient ?? '', body.amount ?? 0);
        }
    } else if (url.pathname === '/api/airdrop/usdc' && req.method === 'POST') {
        const parseResult = await parseJsonBody(req);
        if (!parseResult.success) {
            response = jsonResponse({ error: parseResult.error }, 400);
        } else {
            const body = extractFields<{ recipient?: string; amount?: number }>(parseResult.data, {
                recipient: 'optional_string',
                amount: 'optional_number',
            });
            response = await handleUsdcAirdrop(body.recipient ?? '', body.amount ?? 0);
        }
    } else if (url.pathname === '/api/program/status' && req.method === 'GET') {
        const rpcUrl = url.searchParams.get('rpcUrl') ?? RPC_URL;
        try {
            const rpcHost = new URL(rpcUrl).hostname;
            if (!ALLOWED_RPC_HOSTS.includes(rpcHost)) {
                response = jsonResponse({ error: 'RPC URL not allowed' }, 400);
                const duration = Date.now() - startTime;
                log('info', `${req.method} ${url.pathname}`, { status: response.status, duration: `${duration}ms` });
                return response;
            }
        } catch {
            response = jsonResponse({ error: 'Invalid RPC URL' }, 400);
            const duration = Date.now() - startTime;
            log('info', `${req.method} ${url.pathname}`, { status: response.status, duration: `${duration}ms` });
            return response;
        }
        const programAddrParam = url.searchParams.get('programAddress');
        if (programAddrParam && !BASE58_RE.test(programAddrParam)) {
            response = jsonResponse({ error: 'Invalid program address' }, 400);
            const duration = Date.now() - startTime;
            log('info', `${req.method} ${url.pathname}`, { status: response.status, duration: `${duration}ms` });
            return response;
        }
        let programAddr = programAddrParam;
        if (!programAddr) {
            const config = await readConfig();
            const network = networkFromRpcUrl(rpcUrl);
            programAddr = config.networks[network]?.programAddress ?? PROGRAM_ADDRESS;
        }
        response = await handleProgramStatus(rpcUrl, programAddr);
    } else if (url.pathname === '/api/program/binary-info' && req.method === 'GET') {
        response = await handleBinaryInfo();
    } else if (url.pathname === '/api/program/prepare-deploy' && req.method === 'POST') {
        const parseResult = await parseJsonBody(req);
        if (!parseResult.success) {
            response = jsonResponse({ error: parseResult.error }, 400);
        } else {
            const deployBody = extractFields<{ isUpgrade?: boolean; programAddress?: string; rpcUrl?: string }>(
                parseResult.data,
                {
                    isUpgrade: 'optional_boolean',
                    programAddress: 'optional_string',
                    rpcUrl: 'optional_string',
                },
            );
            response = await handlePrepareDeploy(deployBody);
        }
    } else if (url.pathname === '/api/setup/start-validator' && req.method === 'POST') {
        response = await handleStartValidator();
    } else if (url.pathname === '/api/setup/validator-status' && req.method === 'GET') {
        response = await handleValidatorStatus();
    } else if (url.pathname === '/api/setup/create-mock-usdc' && req.method === 'POST') {
        response = await handleCreateMockUsdc();
    } else if (url.pathname === '/api/setup/save-config' && req.method === 'POST') {
        const parseResult = await parseJsonBody(req);
        if (!parseResult.success) {
            response = jsonResponse({ error: parseResult.error }, 400);
        } else {
            const configBody = extractFields<{ network?: string; programAddress?: string; tokens?: object }>(
                parseResult.data,
                {
                    network: 'optional_string',
                    programAddress: 'optional_string',
                    tokens: 'optional_object',
                },
            );
            response = await handleSaveConfig(
                configBody as {
                    network?: string;
                    programAddress?: string;
                    tokens?: Array<{ symbol: string; mint: string; decimals: number }>;
                },
            );
        }
    } else {
        response = jsonResponse({ error: 'Not found' }, 404);
    }

    const duration = Date.now() - startTime;
    log('info', `${req.method} ${url.pathname}`, { status: response.status, duration: `${duration}ms` });

    return response;
}

const server = createServer(async (req, res) => {
    const url = `http://localhost:${PORT}${req.url}`;
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
        if (value) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
    }

    const MAX_BODY_SIZE = 10 * 1024 * 1024;
    let body: string | undefined;
    if (req.method === 'POST' || req.method === 'PUT') {
        body = await new Promise<string>((resolve, reject) => {
            let data = '';
            let size = 0;
            req.on('data', (chunk: Buffer) => {
                size += chunk.length;
                if (size > MAX_BODY_SIZE) {
                    req.destroy();
                    reject(new Error('Request body too large'));
                    return;
                }
                data += chunk;
            });
            req.on('end', () => resolve(data));
            req.on('error', reject);
        }).catch(err => {
            log('warn', 'Body read error', { error: String(err) });
            return undefined;
        });
        if (body === undefined) {
            res.writeHead(413, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Request body too large' }));
            return;
        }
    }

    const request = new Request(url, { method: req.method ?? 'GET', headers, body });
    const response = await handleRequest(request);

    const respHeaders: Record<string, string> = {};
    response.headers.forEach((v, k) => {
        respHeaders[k] = v;
    });
    res.writeHead(response.status, respHeaders);
    res.end(await response.text());
});

server.listen(PORT, HOST, () => {
    console.log(`World Cup API server running on http://${HOST}:${PORT}`);
    console.log('');
    console.log('Endpoints:');
    console.log(`  GET  http://${HOST}:${PORT}/api/health`);
    console.log(`  GET  http://${HOST}:${PORT}/api/config`);
    console.log(`  GET  http://${HOST}:${PORT}/api/tokens`);
    console.log(`  POST http://${HOST}:${PORT}/api/airdrop/sol`);
    console.log(`  POST http://${HOST}:${PORT}/api/airdrop/usdc`);
    console.log(`  GET  http://${HOST}:${PORT}/api/program/status`);
    console.log(`  GET  http://${HOST}:${PORT}/api/program/binary-info`);
    console.log(`  POST http://${HOST}:${PORT}/api/program/prepare-deploy`);
    console.log(`  POST http://${HOST}:${PORT}/api/setup/start-validator`);
    console.log(`  GET  http://${HOST}:${PORT}/api/setup/validator-status`);
    console.log(`  POST http://${HOST}:${PORT}/api/setup/create-mock-usdc`);
    console.log(`  POST http://${HOST}:${PORT}/api/setup/save-config`);
});
