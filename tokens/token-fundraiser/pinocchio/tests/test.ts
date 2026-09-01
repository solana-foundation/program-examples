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
import { getCreateAccountInstruction, SYSTEM_PROGRAM_ADDRESS } from '@solana-program/system';
import {
    ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
    findAssociatedTokenPda,
    getCreateAssociatedTokenInstruction,
    getInitializeMint2Instruction,
    getMintToInstruction,
    getTokenDecoder,
    getTransferInstruction,
    TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token';
import { assert } from 'chai';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';

const MINT_SIZE = 82n;
const SECONDS_PER_DAY = 86_400n;

const PROGRAM_SO = path.join(process.cwd(), 'tests', 'fixtures', 'fundraiser_pinocchio_program.so');
const addressEncoder = getAddressEncoder();

// Little-endian encoders for the raw instruction data the program expects.
function u64(n: bigint): Uint8Array {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setBigUint64(0, n, true);
    return b;
}
function u16(n: number): Uint8Array {
    const b = new Uint8Array(2);
    new DataView(b.buffer).setUint16(0, n, true);
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

describe('Token Fundraiser (Pinocchio)', () => {
    let svm: LiteSVM;
    let programId: Address;

    before(async () => {
        svm = new LiteSVM();
        programId = (await generateKeyPairSigner()).address;
        svm.addProgramFromFile(programId, PROGRAM_SO);
    });

    function send(signedTx: Parameters<typeof svm.sendTransaction>[0], label: string) {
        const result = svm.sendTransaction(signedTx);
        if (result instanceof FailedTransactionMetadata) {
            throw new Error(`${label} failed: ${result.err()}`);
        }
    }

    // Asserts a transaction is rejected on-chain rather than succeeding.
    function sendExpectingFailure(signedTx: Parameters<typeof svm.sendTransaction>[0], label: string) {
        const result = svm.sendTransaction(signedTx);
        assert.instanceOf(result, FailedTransactionMetadata, `${label} should have been rejected`);
    }

    async function tx(payer: KeyPairSigner, instructions: Parameters<typeof appendTransactionMessageInstruction>[0][]) {
        return signTransactionMessageWithSigners(
            pipe(
                createTransactionMessage({ version: 0 }),
                m => setTransactionMessageFeePayerSigner(payer, m),
                m => svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
                m => appendTransactionMessageInstructions(instructions, m),
            ),
        );
    }

    // Creates a plain SPL mint with the given decimals and authority.
    async function createMint(payer: KeyPairSigner, decimals: number, mintAuthority: Address): Promise<KeyPairSigner> {
        const mint = await generateKeyPairSigner();
        send(
            await tx(payer, [
                getCreateAccountInstruction({
                    payer,
                    newAccount: mint,
                    lamports: svm.minimumBalanceForRentExemption(MINT_SIZE),
                    space: MINT_SIZE,
                    programAddress: TOKEN_PROGRAM_ADDRESS,
                }),
                getInitializeMint2Instruction({ mint: mint.address, decimals, mintAuthority, freezeAuthority: null }),
            ]),
            'create mint',
        );
        return mint;
    }

    // Creates `owner`'s associated token account and mints `amount` into it.
    async function fundAta(
        payer: KeyPairSigner,
        mintAuthority: KeyPairSigner,
        owner: Address,
        mint: Address,
        amount: bigint,
    ): Promise<Address> {
        const [ata] = await findAssociatedTokenPda({ owner, mint, tokenProgram: TOKEN_PROGRAM_ADDRESS });
        send(
            await tx(payer, [
                getCreateAssociatedTokenInstruction({ payer, ata, owner, mint }),
                getMintToInstruction({ mint, token: ata, mintAuthority, amount }),
            ]),
            'fund ata',
        );
        return ata;
    }

    function fundraiserPda(maker: Address) {
        return getProgramDerivedAddress({
            programAddress: programId,
            seeds: ['fundraiser', addressEncoder.encode(maker)],
        });
    }
    function contributorPda(fundraiser: Address, contributor: Address) {
        return getProgramDerivedAddress({
            programAddress: programId,
            seeds: ['contributor', addressEncoder.encode(fundraiser), addressEncoder.encode(contributor)],
        });
    }
    function tokenAmount(account: Address): bigint {
        const acc = svm.getAccount(account);
        if (!acc?.exists) throw new Error('token account not found');
        return getTokenDecoder().decode(acc.data).amount;
    }

    function initializeIx(
        maker: KeyPairSigner,
        mint: Address,
        fundraiser: Address,
        vault: Address,
        bump: number,
        amount: bigint,
        duration: number,
    ) {
        return {
            programAddress: programId,
            accounts: [
                { address: fundraiser, role: AccountRole.WRITABLE },
                { address: mint, role: AccountRole.READONLY },
                { address: vault, role: AccountRole.WRITABLE },
                { address: maker.address, role: AccountRole.WRITABLE_SIGNER, signer: maker },
                { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
                { address: ASSOCIATED_TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ],
            data: concatBytes(Uint8Array.of(0), u64(amount), u16(duration), Uint8Array.of(bump)),
        };
    }

    function contributeIx(
        contributor: KeyPairSigner,
        mint: Address,
        fundraiser: Address,
        contributorAccount: Address,
        contributorAta: Address,
        vault: Address,
        amount: bigint,
    ) {
        return {
            programAddress: programId,
            accounts: [
                { address: contributor.address, role: AccountRole.WRITABLE_SIGNER, signer: contributor },
                { address: mint, role: AccountRole.READONLY },
                { address: fundraiser, role: AccountRole.WRITABLE },
                { address: contributorAccount, role: AccountRole.WRITABLE },
                { address: contributorAta, role: AccountRole.WRITABLE },
                { address: vault, role: AccountRole.WRITABLE },
                { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ],
            // The contributor PDA bump is derived on-chain, not supplied here.
            data: concatBytes(Uint8Array.of(1), u64(amount)),
        };
    }

    function refundIx(
        contributor: KeyPairSigner,
        maker: Address,
        mint: Address,
        fundraiser: Address,
        contributorAccount: Address,
        contributorAta: Address,
        vault: Address,
    ) {
        return {
            programAddress: programId,
            accounts: [
                { address: contributor.address, role: AccountRole.WRITABLE_SIGNER, signer: contributor },
                { address: maker, role: AccountRole.READONLY },
                { address: mint, role: AccountRole.READONLY },
                { address: fundraiser, role: AccountRole.WRITABLE },
                { address: contributorAccount, role: AccountRole.WRITABLE },
                { address: contributorAta, role: AccountRole.WRITABLE },
                { address: vault, role: AccountRole.WRITABLE },
                { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ],
            data: Uint8Array.of(3),
        };
    }

    function checkIx(maker: KeyPairSigner, mint: Address, fundraiser: Address, vault: Address, makerAta: Address) {
        return {
            programAddress: programId,
            accounts: [
                { address: maker.address, role: AccountRole.WRITABLE_SIGNER, signer: maker },
                { address: mint, role: AccountRole.READONLY },
                { address: fundraiser, role: AccountRole.WRITABLE },
                { address: vault, role: AccountRole.WRITABLE },
                { address: makerAta, role: AccountRole.WRITABLE },
                { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
                { address: ASSOCIATED_TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ],
            data: Uint8Array.of(2),
        };
    }

    function warpDays(days: number) {
        const clock = svm.getClock();
        clock.unixTimestamp += BigInt(days) * SECONDS_PER_DAY;
        svm.setClock(clock);
    }

    it('Refunds a contributor after the fundraiser ends without meeting its target', async () => {
        const maker = await generateKeyPairSigner();
        svm.airdrop(maker.address, lamports(1_000_000_000n));
        const mint = await createMint(maker, 0, maker.address);

        const [fundraiser, bump] = await fundraiserPda(maker.address);
        const [vault] = await findAssociatedTokenPda({
            owner: fundraiser,
            mint: mint.address,
            tokenProgram: TOKEN_PROGRAM_ADDRESS,
        });

        // Goal of 100 over 1 day; a single contributor gives the 10% max (10).
        send(await tx(maker, [initializeIx(maker, mint.address, fundraiser, vault, bump, 100n, 1)]), 'initialize');

        const contributor = await generateKeyPairSigner();
        svm.airdrop(contributor.address, lamports(1_000_000_000n));
        const contributorAta = await fundAta(maker, maker, contributor.address, mint.address, 10n);
        const [contributorAccount] = await contributorPda(fundraiser, contributor.address);

        send(
            await tx(contributor, [
                contributeIx(contributor, mint.address, fundraiser, contributorAccount, contributorAta, vault, 10n),
            ]),
            'contribute',
        );

        assert.equal(tokenAmount(vault), 10n, 'vault holds the contribution');
        assert.equal(tokenAmount(contributorAta), 0n, 'contributor spent their tokens');

        // The fundraiser ends without meeting the 100 target; the contributor refunds.
        warpDays(2);
        send(
            await tx(contributor, [
                refundIx(
                    contributor,
                    maker.address,
                    mint.address,
                    fundraiser,
                    contributorAccount,
                    contributorAta,
                    vault,
                ),
            ]),
            'refund',
        );

        assert.equal(tokenAmount(contributorAta), 10n, 'contributor got their tokens back');
        assert.equal(tokenAmount(vault), 0n, 'vault is empty after the refund');
        assert.isNotOk(svm.getAccount(contributorAccount)?.exists, 'contributor account was closed');
    });

    it('Releases the funds to the maker once the target is met', async () => {
        const maker = await generateKeyPairSigner();
        svm.airdrop(maker.address, lamports(1_000_000_000n));
        const mint = await createMint(maker, 0, maker.address);

        const [fundraiser, bump] = await fundraiserPda(maker.address);
        const [vault] = await findAssociatedTokenPda({
            owner: fundraiser,
            mint: mint.address,
            tokenProgram: TOKEN_PROGRAM_ADDRESS,
        });

        // Goal of 100 over 30 days; the 10% cap means it takes ten contributors.
        send(await tx(maker, [initializeIx(maker, mint.address, fundraiser, vault, bump, 100n, 30)]), 'initialize');

        for (let i = 0; i < 10; i++) {
            const contributor = await generateKeyPairSigner();
            svm.airdrop(contributor.address, lamports(1_000_000_000n));
            const contributorAta = await fundAta(maker, maker, contributor.address, mint.address, 10n);
            const [contributorAccount] = await contributorPda(fundraiser, contributor.address);
            send(
                await tx(contributor, [
                    contributeIx(contributor, mint.address, fundraiser, contributorAccount, contributorAta, vault, 10n),
                ]),
                `contribute ${i}`,
            );
        }

        assert.equal(tokenAmount(vault), 100n, 'vault reached the target');

        const [makerAta] = await findAssociatedTokenPda({
            owner: maker.address,
            mint: mint.address,
            tokenProgram: TOKEN_PROGRAM_ADDRESS,
        });
        send(await tx(maker, [checkIx(maker, mint.address, fundraiser, vault, makerAta)]), 'check contributions');

        assert.equal(tokenAmount(makerAta), 100n, 'maker received the raised funds');
        assert.isNotOk(svm.getAccount(fundraiser)?.exists, 'fundraiser account was closed');
    });

    it("Rejects a contribution credited to another contributor's record", async () => {
        const maker = await generateKeyPairSigner();
        svm.airdrop(maker.address, lamports(1_000_000_000n));
        const mint = await createMint(maker, 0, maker.address);

        const [fundraiser, bump] = await fundraiserPda(maker.address);
        const [vault] = await findAssociatedTokenPda({
            owner: fundraiser,
            mint: mint.address,
            tokenProgram: TOKEN_PROGRAM_ADDRESS,
        });
        send(await tx(maker, [initializeIx(maker, mint.address, fundraiser, vault, bump, 100n, 30)]), 'initialize');

        // Victim contributes first, which creates their program-owned record.
        // Amounts stay well under the 10% cap so that the substituted-record
        // rejection cannot be attributed to the per-contributor limit.
        const victim = await generateKeyPairSigner();
        svm.airdrop(victim.address, lamports(1_000_000_000n));
        const victimAta = await fundAta(maker, maker, victim.address, mint.address, 1n);
        const [victimAccount] = await contributorPda(fundraiser, victim.address);
        send(
            await tx(victim, [contributeIx(victim, mint.address, fundraiser, victimAccount, victimAta, vault, 1n)]),
            'victim contribute',
        );

        // The attacker signs their own transfer but points at the victim's record.
        const attacker = await generateKeyPairSigner();
        svm.airdrop(attacker.address, lamports(1_000_000_000n));
        const attackerAta = await fundAta(maker, maker, attacker.address, mint.address, 1n);
        sendExpectingFailure(
            await tx(attacker, [
                contributeIx(attacker, mint.address, fundraiser, victimAccount, attackerAta, vault, 1n),
            ]),
            'contribution into a substituted record',
        );

        assert.equal(tokenAmount(attackerAta), 1n, 'attacker kept their tokens');
        assert.equal(tokenAmount(vault), 1n, 'vault only holds the recorded contribution');
    });

    it('Rejects a contributor record that is not the canonical PDA', async () => {
        const maker = await generateKeyPairSigner();
        svm.airdrop(maker.address, lamports(1_000_000_000n));
        const mint = await createMint(maker, 0, maker.address);

        const [fundraiser, bump] = await fundraiserPda(maker.address);
        const [vault] = await findAssociatedTokenPda({
            owner: fundraiser,
            mint: mint.address,
            tokenProgram: TOKEN_PROGRAM_ADDRESS,
        });
        send(await tx(maker, [initializeIx(maker, mint.address, fundraiser, vault, bump, 100n, 30)]), 'initialize');

        // The record address is derived on-chain, so a contributor cannot open a
        // second record for themselves at any other address — including one
        // derived from a non-canonical bump. A record that is not the canonical
        // PDA is refused before it can be created, which also keeps every record
        // reachable by `refund` (which only ever derives the canonical address).
        const contributor = await generateKeyPairSigner();
        svm.airdrop(contributor.address, lamports(1_000_000_000n));
        const contributorAta = await fundAta(maker, maker, contributor.address, mint.address, 5n);
        const notTheCanonicalPda = (await generateKeyPairSigner()).address;

        sendExpectingFailure(
            await tx(contributor, [
                contributeIx(contributor, mint.address, fundraiser, notTheCanonicalPda, contributorAta, vault, 5n),
            ]),
            'contribution into a non-canonical record',
        );

        assert.equal(tokenAmount(contributorAta), 5n, 'contributor kept their tokens');
        assert.isNotOk(svm.getAccount(notTheCanonicalPda)?.exists, 'no second record was created');
    });

    it('Ignores unrecorded direct transfers into the vault', async () => {
        const maker = await generateKeyPairSigner();
        svm.airdrop(maker.address, lamports(1_000_000_000n));
        const mint = await createMint(maker, 0, maker.address);

        const [fundraiser, bump] = await fundraiserPda(maker.address);
        const [vault] = await findAssociatedTokenPda({
            owner: fundraiser,
            mint: mint.address,
            tokenProgram: TOKEN_PROGRAM_ADDRESS,
        });

        // Goal of 100 over 1 day; a single contributor gives the 10% max (10).
        send(await tx(maker, [initializeIx(maker, mint.address, fundraiser, vault, bump, 100n, 1)]), 'initialize');

        const contributor = await generateKeyPairSigner();
        svm.airdrop(contributor.address, lamports(1_000_000_000n));
        const contributorAta = await fundAta(maker, maker, contributor.address, mint.address, 10n);
        const [contributorAccount] = await contributorPda(fundraiser, contributor.address);
        send(
            await tx(contributor, [
                contributeIx(contributor, mint.address, fundraiser, contributorAccount, contributorAta, vault, 10n),
            ]),
            'contribute',
        );

        // Anyone can transfer straight into the vault's standard ATA. That must
        // neither release the fundraiser nor lock the contributor out of a refund.
        const outsiderAta = await fundAta(maker, maker, maker.address, mint.address, 90n);
        send(
            await tx(maker, [
                getTransferInstruction({ source: outsiderAta, destination: vault, authority: maker, amount: 90n }),
            ]),
            'direct vault transfer',
        );
        assert.equal(tokenAmount(vault), 100n, 'vault balance now looks like the target was met');

        const [makerAta] = await findAssociatedTokenPda({
            owner: maker.address,
            mint: mint.address,
            tokenProgram: TOKEN_PROGRAM_ADDRESS,
        });
        sendExpectingFailure(
            await tx(maker, [checkIx(maker, mint.address, fundraiser, vault, makerAta)]),
            'release on an unrecorded deposit',
        );

        // The contributor is still refundable once the fundraiser ends.
        warpDays(2);
        send(
            await tx(contributor, [
                refundIx(
                    contributor,
                    maker.address,
                    mint.address,
                    fundraiser,
                    contributorAccount,
                    contributorAta,
                    vault,
                ),
            ]),
            'refund',
        );
        assert.equal(tokenAmount(contributorAta), 10n, 'contributor got their tokens back');
    });
});
