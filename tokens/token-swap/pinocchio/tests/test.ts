import * as path from 'node:path';
import {
    AccountRole,
    type Address,
    type KeyPairSigner,
    appendTransactionMessageInstruction,
    appendTransactionMessageInstructions,
    createTransactionMessage,
    generateKeyPairSigner,
    getAddressEncoder,
    getProgramDerivedAddress,
    lamports,
    pipe,
    setTransactionMessageFeePayerSigner,
    signTransactionMessageWithSigners,
} from '@solana/kit';
import { SYSTEM_PROGRAM_ADDRESS, getCreateAccountInstruction } from '@solana-program/system';
import {
    ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
    TOKEN_PROGRAM_ADDRESS,
    findAssociatedTokenPda,
    getCreateAssociatedTokenInstruction,
    getInitializeAccount3Instruction,
    getInitializeMint2Instruction,
    getMintToInstruction,
    getTokenDecoder,
} from '@solana-program/token-2022';
import { assert } from 'chai';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';

const CREATE_AMM = 0;
const CREATE_POOL = 1;
const DEPOSIT_LIQUIDITY = 2;
const WITHDRAW_LIQUIDITY = 3;
const SWAP = 4;

const MINT_SIZE = 82n;
const DECIMALS = 6;
const FEE_BASIS_POINTS = 500; // 5%
const MINIMUM_LIQUIDITY = 100n;
const FUNDED = 1_000_000n;
const DEPOSIT_A = 100_000n;
const DEPOSIT_B = 400_000n;

const PROGRAM_SO = path.join(process.cwd(), 'tests', 'fixtures', 'token_swap_pinocchio_program.so');
const addressEncoder = getAddressEncoder();

function u16le(n: number): Uint8Array {
    return Uint8Array.of(n & 0xff, (n >> 8) & 0xff);
}
function u64(n: bigint): Uint8Array {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setBigUint64(0, n, true);
    return b;
}
function concatBytes(...parts: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let offset = 0;
    for (const p of parts) {
        out.set(p, offset);
        offset += p.length;
    }
    return out;
}
function isqrt(value: bigint): bigint {
    if (value < 2n) return value;
    let x = value;
    let y = (x + 1n) / 2n;
    while (y < x) {
        x = y;
        y = (x + value / x) / 2n;
    }
    return x;
}

describe('Token Swap (Pinocchio)', () => {
    let svm: LiteSVM;
    let programId: Address;
    let payer: KeyPairSigner;
    let ammId: Uint8Array;
    let amm: Address;
    let mintA: KeyPairSigner;
    let mintB: KeyPairSigner;
    let pool: Address;
    let poolAuthority: Address;
    let mintLiquidity: Address;
    let poolAccountA: Address;
    let poolAccountB: Address;
    let userA: Address;
    let userB: Address;
    let userLiquidity: Address;

    before(async () => {
        svm = new LiteSVM();
        // The program derives every PDA from the id it is invoked with, so a
        // generated id keeps the test self-contained.
        programId = (await generateKeyPairSigner()).address;
        svm.addProgramFromFile(programId, PROGRAM_SO);

        payer = await generateKeyPairSigner();
        svm.airdrop(payer.address, lamports(100_000_000_000n));

        // Mint A must sort before mint B only in the caller's convention; the
        // program takes them in the order given.
        mintA = await generateKeyPairSigner();
        mintB = await generateKeyPairSigner();

        ammId = new Uint8Array(addressEncoder.encode((await generateKeyPairSigner()).address));
        [amm] = await getProgramDerivedAddress({ programAddress: programId, seeds: [ammId] });
    });

    async function derivePoolAddresses() {
        const a = addressEncoder.encode(mintA.address);
        const b = addressEncoder.encode(mintB.address);
        const ammBytes = addressEncoder.encode(amm);
        [pool] = await getProgramDerivedAddress({ programAddress: programId, seeds: [ammBytes, a, b] });
        [poolAuthority] = await getProgramDerivedAddress({
            programAddress: programId,
            seeds: [ammBytes, a, b, 'authority'],
        });
        [mintLiquidity] = await getProgramDerivedAddress({
            programAddress: programId,
            seeds: [ammBytes, a, b, 'liquidity'],
        });
        [poolAccountA] = await findAssociatedTokenPda({
            owner: poolAuthority,
            mint: mintA.address,
            tokenProgram: TOKEN_PROGRAM_ADDRESS,
        });
        [poolAccountB] = await findAssociatedTokenPda({
            owner: poolAuthority,
            mint: mintB.address,
            tokenProgram: TOKEN_PROGRAM_ADDRESS,
        });
        [userLiquidity] = await findAssociatedTokenPda({
            owner: payer.address,
            mint: mintLiquidity,
            tokenProgram: TOKEN_PROGRAM_ADDRESS,
        });
    }

    async function tx(instructions: Parameters<typeof appendTransactionMessageInstruction>[0][]) {
        return signTransactionMessageWithSigners(
            pipe(
                createTransactionMessage({ version: 0 }),
                m => setTransactionMessageFeePayerSigner(payer, m),
                m => svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
                m => appendTransactionMessageInstructions(instructions, m),
            ),
        );
    }

    function send(signedTx: Parameters<typeof svm.sendTransaction>[0], label: string) {
        const result = svm.sendTransaction(signedTx);
        if (result instanceof FailedTransactionMetadata) {
            throw new Error(`${label} failed: ${result.err()}`);
        }
        return result;
    }

    function tokenAmount(account: Address): bigint {
        const acc = svm.getAccount(account);
        if (!acc?.exists) throw new Error(`token account ${account} not found`);
        return getTokenDecoder().decode(acc.data).amount;
    }

    function createAmmIx(id: Uint8Array, ammAddress: Address, fee: number) {
        return {
            programAddress: programId,
            accounts: [
                { address: ammAddress, role: AccountRole.WRITABLE },
                { address: payer.address, role: AccountRole.READONLY },
                { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ],
            data: concatBytes(Uint8Array.of(CREATE_AMM), id, u16le(fee)),
        };
    }

    function depositIx(amountA: bigint, amountB: bigint) {
        return {
            programAddress: programId,
            accounts: [
                { address: pool, role: AccountRole.READONLY },
                { address: poolAuthority, role: AccountRole.READONLY },
                { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
                { address: mintLiquidity, role: AccountRole.WRITABLE },
                { address: mintA.address, role: AccountRole.READONLY },
                { address: mintB.address, role: AccountRole.READONLY },
                { address: poolAccountA, role: AccountRole.WRITABLE },
                { address: poolAccountB, role: AccountRole.WRITABLE },
                { address: userLiquidity, role: AccountRole.WRITABLE },
                { address: userA, role: AccountRole.WRITABLE },
                { address: userB, role: AccountRole.WRITABLE },
                { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
                { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
                { address: ASSOCIATED_TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ],
            data: concatBytes(Uint8Array.of(DEPOSIT_LIQUIDITY), u64(amountA), u64(amountB)),
        };
    }

    function swapIx(swapA: boolean, input: bigint, minOutput: bigint) {
        return {
            programAddress: programId,
            accounts: [
                { address: amm, role: AccountRole.READONLY },
                { address: pool, role: AccountRole.READONLY },
                { address: poolAuthority, role: AccountRole.READONLY },
                { address: payer.address, role: AccountRole.READONLY_SIGNER, signer: payer },
                { address: mintA.address, role: AccountRole.READONLY },
                { address: mintB.address, role: AccountRole.READONLY },
                { address: poolAccountA, role: AccountRole.WRITABLE },
                { address: poolAccountB, role: AccountRole.WRITABLE },
                { address: userA, role: AccountRole.WRITABLE },
                { address: userB, role: AccountRole.WRITABLE },
                { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ],
            data: concatBytes(Uint8Array.of(SWAP), Uint8Array.of(swapA ? 1 : 0), u64(input), u64(minOutput)),
        };
    }

    it('Creates an AMM', async () => {
        send(await tx([createAmmIx(ammId, amm, FEE_BASIS_POINTS)]), 'create amm');

        const account = svm.getAccount(amm);
        if (!account?.exists) throw new Error('amm not found');
        assert.equal(account.programAddress, programId, 'the AMM is owned by the program');
        assert.deepEqual(Array.from(account.data.slice(0, 32)), Array.from(ammId), 'the id was recorded');
        assert.equal(new DataView(account.data.buffer, account.data.byteOffset).getUint16(64, true), FEE_BASIS_POINTS);
    });

    it('Rejects a fee of 100% or more', async () => {
        const id = new Uint8Array(addressEncoder.encode((await generateKeyPairSigner()).address));
        const [address] = await getProgramDerivedAddress({ programAddress: programId, seeds: [id] });

        const result = svm.sendTransaction(await tx([createAmmIx(id, address, 10_000)]));
        assert.instanceOf(result, FailedTransactionMetadata, 'expected the fee to be refused');
        assert.include(
            (result as FailedTransactionMetadata).meta().logs().join('\n'),
            'custom program error: 0x0',
            'rejected with InvalidFee',
        );
    });

    it('Creates the mints and funds the depositor', async () => {
        [userA] = await findAssociatedTokenPda({
            owner: payer.address,
            mint: mintA.address,
            tokenProgram: TOKEN_PROGRAM_ADDRESS,
        });
        [userB] = await findAssociatedTokenPda({
            owner: payer.address,
            mint: mintB.address,
            tokenProgram: TOKEN_PROGRAM_ADDRESS,
        });

        for (const [mint, ata] of [
            [mintA, userA],
            [mintB, userB],
        ] as const) {
            send(
                await tx([
                    getCreateAccountInstruction({
                        payer,
                        newAccount: mint,
                        lamports: lamports(svm.minimumBalanceForRentExemption(MINT_SIZE)),
                        space: MINT_SIZE,
                        programAddress: TOKEN_PROGRAM_ADDRESS,
                    }),
                    getInitializeMint2Instruction(
                        { mint: mint.address, decimals: DECIMALS, mintAuthority: payer.address, freezeAuthority: null },
                        { programAddress: TOKEN_PROGRAM_ADDRESS },
                    ),
                    getCreateAssociatedTokenInstruction({
                        payer,
                        ata,
                        owner: payer.address,
                        mint: mint.address,
                        tokenProgram: TOKEN_PROGRAM_ADDRESS,
                    }),
                    getMintToInstruction(
                        { mint: mint.address, token: ata, mintAuthority: payer, amount: FUNDED },
                        { programAddress: TOKEN_PROGRAM_ADDRESS },
                    ),
                ]),
                'create mint',
            );
        }

        assert.equal(tokenAmount(userA), FUNDED);
        assert.equal(tokenAmount(userB), FUNDED);
    });

    it('Creates the pool', async () => {
        await derivePoolAddresses();

        const ix = {
            programAddress: programId,
            accounts: [
                { address: amm, role: AccountRole.READONLY },
                { address: pool, role: AccountRole.WRITABLE },
                { address: poolAuthority, role: AccountRole.READONLY },
                { address: mintLiquidity, role: AccountRole.WRITABLE },
                { address: mintA.address, role: AccountRole.READONLY },
                { address: mintB.address, role: AccountRole.READONLY },
                { address: poolAccountA, role: AccountRole.WRITABLE },
                { address: poolAccountB, role: AccountRole.WRITABLE },
                { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer },
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
                { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
                { address: ASSOCIATED_TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ],
            data: Uint8Array.of(CREATE_POOL),
        };
        send(await tx([ix]), 'create pool');

        const account = svm.getAccount(pool);
        if (!account?.exists) throw new Error('pool not found');
        assert.deepEqual(
            Array.from(account.data.slice(32, 64)),
            Array.from(addressEncoder.encode(mintA.address)),
            'mint A recorded',
        );
        assert.equal(tokenAmount(poolAccountA), 0n, 'vault A starts empty');
        assert.equal(tokenAmount(poolAccountB), 0n, 'vault B starts empty');
    });

    it('Takes the first deposit and locks the minimum liquidity', async () => {
        send(await tx([depositIx(DEPOSIT_A, DEPOSIT_B)]), 'deposit liquidity');

        assert.equal(tokenAmount(poolAccountA), DEPOSIT_A, 'vault A funded');
        assert.equal(tokenAmount(poolAccountB), DEPOSIT_B, 'vault B funded');

        // Shares are the geometric mean, less the permanently locked minimum.
        const expected = isqrt(DEPOSIT_A * DEPOSIT_B) - MINIMUM_LIQUIDITY;
        assert.equal(tokenAmount(userLiquidity), expected, 'LP tokens minted, minus the locked minimum');
    });

    it('Swaps A for B along the constant product curve', async () => {
        const input = 10_000n;
        const poolABefore = tokenAmount(poolAccountA);
        const poolBBefore = tokenAmount(poolAccountB);
        const userBBefore = tokenAmount(userB);

        const taxed = input - (input * BigInt(FEE_BASIS_POINTS)) / 10_000n;
        const expectedOutput = (taxed * poolBBefore) / (poolABefore + taxed);

        send(await tx([swapIx(true, input, 1n)]), 'swap a for b');

        assert.equal(tokenAmount(userB) - userBBefore, expectedOutput, 'output matches the curve');
        assert.equal(tokenAmount(poolAccountA), poolABefore + input, 'the full input entered the pool');

        // The fee stays in the pool, so the invariant strictly grows.
        assert.isAbove(
            Number(tokenAmount(poolAccountA) * tokenAmount(poolAccountB)),
            Number(poolABefore * poolBBefore),
            'the invariant did not fall',
        );
    });

    it('Rejects a swap whose output would miss the minimum', async () => {
        const result = svm.sendTransaction(await tx([swapIx(true, 1_000n, 1_000_000n)]));
        assert.instanceOf(result, FailedTransactionMetadata, 'expected the slippage guard to fire');
        assert.include(
            (result as FailedTransactionMetadata).meta().logs().join('\n'),
            'custom program error: 0x3',
            'rejected with OutputTooSmall',
        );
    });

    it('Trims a lopsided deposit to the pool ratio', async () => {
        const poolABefore = tokenAmount(poolAccountA);
        const poolBBefore = tokenAmount(poolAccountB);
        const userABefore = tokenAmount(userA);

        // Offer far more B than the ratio needs; only the matching amount of B
        // should be taken for the A supplied.
        const offerA = 10_000n;
        const expectedB = (offerA * poolBBefore) / poolABefore;

        send(await tx([depositIx(offerA, FUNDED)]), 'ratio deposit');

        assert.equal(userABefore - tokenAmount(userA), offerA, 'all of the offered A was taken');
        assert.equal(tokenAmount(poolAccountB) - poolBBefore, expectedB, 'only the matching B was taken');
    });

    it('Withdraws liquidity back to both sides', async () => {
        const shares = tokenAmount(userLiquidity);
        const userABefore = tokenAmount(userA);
        const userBBefore = tokenAmount(userB);

        const withdrawIx = {
            programAddress: programId,
            accounts: [
                { address: pool, role: AccountRole.READONLY },
                { address: poolAuthority, role: AccountRole.READONLY },
                { address: payer.address, role: AccountRole.READONLY_SIGNER, signer: payer },
                { address: mintLiquidity, role: AccountRole.WRITABLE },
                { address: mintA.address, role: AccountRole.READONLY },
                { address: mintB.address, role: AccountRole.READONLY },
                { address: poolAccountA, role: AccountRole.WRITABLE },
                { address: poolAccountB, role: AccountRole.WRITABLE },
                { address: userLiquidity, role: AccountRole.WRITABLE },
                { address: userA, role: AccountRole.WRITABLE },
                { address: userB, role: AccountRole.WRITABLE },
                { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ],
            data: concatBytes(Uint8Array.of(WITHDRAW_LIQUIDITY), u64(shares)),
        };
        send(await tx([withdrawIx]), 'withdraw liquidity');

        assert.equal(tokenAmount(userLiquidity), 0n, 'all shares burned');
        assert.isAbove(Number(tokenAmount(userA) - userABefore), 0, 'token A returned');
        assert.isAbove(Number(tokenAmount(userB) - userBBefore), 0, 'token B returned');

        // The locked minimum keeps the pool from being emptied entirely.
        assert.isAbove(Number(tokenAmount(poolAccountA)), 0, 'the pool retains the locked share');
        assert.isAbove(Number(tokenAmount(poolAccountB)), 0, 'the pool retains the locked share');
    });

    // A token account for `mint`, owned by the pool authority but NOT its
    // associated token account. Anyone can create one of these, so nothing but
    // an address check keeps it out of an instruction.
    async function rogueVault(mint: Address): Promise<Address> {
        const account = await generateKeyPairSigner();
        const size = 165n;
        const createIx = getCreateAccountInstruction({
            payer,
            newAccount: account,
            lamports: lamports(svm.minimumBalanceForRentExemption(size)),
            space: size,
            programAddress: TOKEN_PROGRAM_ADDRESS,
        });
        const initIx = getInitializeAccount3Instruction(
            { account: account.address, mint, owner: poolAuthority },
            { programAddress: TOKEN_PROGRAM_ADDRESS },
        );
        send(await tx([createIx, initIx]), 'create rogue vault');
        return account.address;
    }

    it('Rejects a swap routed through a substituted vault', async () => {
        // An empty stand-in for the paying side would price the trade against a
        // zero reserve and drain the genuine opposite vault. The vault is owned
        // by the pool authority and holds the right mint, so only rederiving
        // its address catches it.
        const rogue = await rogueVault(mintA.address);
        const base = swapIx(true, 1_000n, 1n);
        const ix = {
            ...base,
            accounts: base.accounts.map((account, index) =>
                index === 6 ? { address: rogue, role: AccountRole.WRITABLE } : account,
            ),
        };

        const poolBBefore = tokenAmount(poolAccountB);
        const result = svm.sendTransaction(await tx([ix]));
        assert.instanceOf(result, FailedTransactionMetadata, 'expected the substituted vault to be rejected');
        assert.include(
            (result as FailedTransactionMetadata).meta().logs().join('\n'),
            'custom program error: 0x6',
            'rejected with InvalidSeeds',
        );
        assert.equal(tokenAmount(poolAccountB), poolBBefore, 'the genuine vault was untouched');
    });

    it('Rejects a deposit routed through a substituted vault', async () => {
        // Otherwise the deposit lands in an account of the caller's choosing
        // while the pool still mints them genuine LP shares.
        const rogue = await rogueVault(mintA.address);
        const base = depositIx(1_000n, 1_000n);
        const ix = {
            ...base,
            accounts: base.accounts.map((account, index) =>
                index === 6 ? { address: rogue, role: AccountRole.WRITABLE } : account,
            ),
        };

        const sharesBefore = tokenAmount(userLiquidity);
        const result = svm.sendTransaction(await tx([ix]));
        assert.instanceOf(result, FailedTransactionMetadata, 'expected the substituted vault to be rejected');
        assert.include(
            (result as FailedTransactionMetadata).meta().logs().join('\n'),
            'custom program error: 0x6',
            'rejected with InvalidSeeds',
        );
        assert.equal(tokenAmount(userLiquidity), sharesBefore, 'no shares were minted');
    });

    it('Rejects a withdrawal against a counterfeit liquidity mint', async () => {
        // The withdrawal entitlement is `amount / (supply + minimum)`, so a mint
        // the caller controls lets them name their own share of the reserves.
        const counterfeit = await generateKeyPairSigner();
        const [counterfeitAta] = await findAssociatedTokenPda({
            owner: payer.address,
            mint: counterfeit.address,
            tokenProgram: TOKEN_PROGRAM_ADDRESS,
        });
        send(
            await tx([
                getCreateAccountInstruction({
                    payer,
                    newAccount: counterfeit,
                    lamports: lamports(svm.minimumBalanceForRentExemption(MINT_SIZE)),
                    space: MINT_SIZE,
                    programAddress: TOKEN_PROGRAM_ADDRESS,
                }),
                getInitializeMint2Instruction(
                    {
                        mint: counterfeit.address,
                        decimals: DECIMALS,
                        mintAuthority: payer.address,
                        freezeAuthority: null,
                    },
                    { programAddress: TOKEN_PROGRAM_ADDRESS },
                ),
                getCreateAssociatedTokenInstruction({
                    payer,
                    ata: counterfeitAta,
                    owner: payer.address,
                    mint: counterfeit.address,
                    tokenProgram: TOKEN_PROGRAM_ADDRESS,
                }),
                getMintToInstruction(
                    { mint: counterfeit.address, token: counterfeitAta, mintAuthority: payer, amount: 1_000n },
                    { programAddress: TOKEN_PROGRAM_ADDRESS },
                ),
            ]),
            'create counterfeit liquidity mint',
        );

        const ix = {
            programAddress: programId,
            accounts: [
                { address: pool, role: AccountRole.READONLY },
                { address: poolAuthority, role: AccountRole.READONLY },
                { address: payer.address, role: AccountRole.READONLY_SIGNER, signer: payer },
                { address: counterfeit.address, role: AccountRole.WRITABLE },
                { address: mintA.address, role: AccountRole.READONLY },
                { address: mintB.address, role: AccountRole.READONLY },
                { address: poolAccountA, role: AccountRole.WRITABLE },
                { address: poolAccountB, role: AccountRole.WRITABLE },
                { address: counterfeitAta, role: AccountRole.WRITABLE },
                { address: userA, role: AccountRole.WRITABLE },
                { address: userB, role: AccountRole.WRITABLE },
                { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ],
            data: concatBytes(Uint8Array.of(WITHDRAW_LIQUIDITY), u64(1_000n)),
        };

        const poolABefore = tokenAmount(poolAccountA);
        const result = svm.sendTransaction(await tx([ix]));
        assert.instanceOf(result, FailedTransactionMetadata, 'expected the counterfeit mint to be rejected');
        assert.include(
            (result as FailedTransactionMetadata).meta().logs().join('\n'),
            'custom program error: 0x6',
            'rejected with InvalidSeeds',
        );
        assert.equal(tokenAmount(poolAccountA), poolABefore, 'the reserves were untouched');
    });

    it('Rejects a pool paired with the wrong mints', async () => {
        // The pool records its own mints, so passing someone else's mint must
        // not let a caller point a real pool at unrelated token accounts.
        const otherMint = await generateKeyPairSigner();
        const ix = {
            ...swapIx(true, 1_000n, 1n),
            accounts: swapIx(true, 1_000n, 1n).accounts.map((account, index) =>
                index === 4 ? { address: otherMint.address, role: AccountRole.READONLY } : account,
            ),
        };

        const result = svm.sendTransaction(await tx([ix]));
        assert.instanceOf(result, FailedTransactionMetadata, 'expected the mint swap to be refused');
        assert.include(
            (result as FailedTransactionMetadata).meta().logs().join('\n'),
            'custom program error: 0x1',
            'rejected with InvalidMint',
        );
    });
});
