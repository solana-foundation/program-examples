import { type Address, generateKeyPairSigner, type KeyPairSigner, lamports } from '@solana/kit';
import { getCreateAccountInstruction } from '@solana-program/system';
import {
    getInitializeAccount3Instruction,
    getTokenDecoder,
    getTokenSize,
    TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token';
import { assert } from 'chai';
import { LiteSVM } from 'litesvm';
import { contributorDecoder, fundraiserDecoder } from './account';
import { buildCheckContributions, buildContribute, buildInitialize, buildRefund } from './instruction';
import {
    createFundedHolder,
    createMint,
    DECIMALS,
    expectFailure,
    expectProgramError,
    findAta,
    findContributorPda,
    findFundraiserPda,
    FundraiserError,
    SECONDS_PER_DAY,
    sendInstructions,
    warpTo,
} from './utils';

// 10 tokens at 6 decimals. The per-contributor cap is 10% of the target, so a
// campaign always needs at least ten distinct contributors to succeed.
const TARGET = 10_000_000n;
const CAP = TARGET / 10n;
const DURATION_DAYS = 1;

// Everything each contributor needs: their wallet, their token account, and the
// contributor PDA that tracks how much they have put in.
interface Contributor {
    wallet: KeyPairSigner;
    ata: Address;
    account: Address;
    bump: number;
}

// A campaign under test.
interface Campaign {
    maker: KeyPairSigner;
    makerAta: Address;
    fundraiser: Address;
    bump: number;
    vault: Address;
}

describe('Token fundraiser (Pinocchio)', () => {
    let svm: LiteSVM;
    let programId: Address;
    let payer: KeyPairSigner;
    let mint: Address;

    // The successful campaign, the campaign that expires unfunded, and the
    // campaign that expires already funded.
    let success: Campaign;
    let expired: Campaign;
    let funded: Campaign;

    let contributors: Contributor[];
    let expiredContributor: Contributor;
    let fundedContributors: Contributor[];

    const tokenBalance = (account: Address): bigint => {
        const info = svm.getAccount(account);
        if (!info.exists) throw new Error(`token account ${account} not found`);
        return getTokenDecoder().decode(info.data).amount;
    };

    const readFundraiser = (account: Address) => {
        const info = svm.getAccount(account);
        if (!info.exists) throw new Error(`fundraiser ${account} not found`);
        return fundraiserDecoder.decode(info.data);
    };

    const readContributor = (account: Address) => {
        const info = svm.getAccount(account);
        if (!info.exists) throw new Error(`contributor ${account} not found`);
        return contributorDecoder.decode(info.data);
    };

    // Builds a campaign's addresses and registers a maker token account.
    async function makeCampaign(): Promise<Campaign> {
        const maker = await generateKeyPairSigner();
        svm.airdrop(maker.address, lamports(1_000_000_000n));
        const [fundraiser, bump] = await findFundraiserPda(programId, maker.address);
        return {
            maker,
            makerAta: await findAta(mint, maker.address),
            fundraiser,
            bump,
            vault: await findAta(mint, fundraiser),
        };
    }

    // Creates a funded wallet plus its contributor PDA for `campaign`.
    async function makeContributor(campaign: Campaign, balance = 5_000_000n): Promise<Contributor> {
        const { holder, ata } = await createFundedHolder(svm, payer, mint, balance);
        const [account, bump] = await findContributorPda(programId, campaign.fundraiser, holder.address);
        return { wallet: holder, ata, account, bump };
    }

    const contributeIx = (campaign: Campaign, contributor: Contributor, amount: bigint) =>
        buildContribute({
            amount,
            contributorBump: contributor.bump,
            contributor: contributor.wallet,
            mint,
            fundraiser: campaign.fundraiser,
            contributorAccount: contributor.account,
            contributorAta: contributor.ata,
            vault: campaign.vault,
            programId,
        });

    const initializeIx = (campaign: Campaign, amount = TARGET, duration = DURATION_DAYS) =>
        buildInitialize({
            amount,
            duration,
            bump: campaign.bump,
            maker: campaign.maker,
            mint,
            fundraiser: campaign.fundraiser,
            vault: campaign.vault,
            programId,
        });

    before(async () => {
        programId = (await generateKeyPairSigner()).address;

        svm = new LiteSVM();
        svm.addProgramFromFile(programId, 'tests/fixtures/fundraiser_pinocchio_program.so');

        payer = await generateKeyPairSigner();
        svm.airdrop(payer.address, lamports(100_000_000_000n));

        const mintKeypair = await generateKeyPairSigner();
        await createMint(svm, payer, mintKeypair);
        mint = mintKeypair.address;

        success = await makeCampaign();
        expired = await makeCampaign();
        funded = await makeCampaign();

        // Ten contributors, so the campaign can reach its target under the cap.
        contributors = [];
        for (let i = 0; i < 10; i++) {
            contributors.push(await makeContributor(success));
        }
        expiredContributor = await makeContributor(expired);
        fundedContributors = [];
        for (let i = 0; i < 10; i++) {
            fundedContributors.push(await makeContributor(funded));
        }
    });

    describe('Initialize', () => {
        it('rejects a target below the minimum', async () => {
            // The minimum is MIN_AMOUNT_TO_RAISE.pow(decimals) = 3^6 = 729.
            const campaign = await makeCampaign();
            await expectProgramError(svm, payer, [initializeIx(campaign, 728n)], FundraiserError.InvalidAmount);
        });

        it('opens a campaign', async () => {
            // LiteSVM's clock starts at unix timestamp 0, so the start time is
            // checked against the clock rather than assumed to be non-zero.
            const startedAt = svm.getClock().unixTimestamp;

            await sendInstructions(svm, payer, [initializeIx(success)]);

            const state = readFundraiser(success.fundraiser);
            assert.strictEqual(state.maker, success.maker.address, 'maker not recorded');
            assert.strictEqual(state.mint_to_raise, mint, 'mint not recorded');
            assert.strictEqual(state.amount_to_raise, TARGET, 'target not recorded');
            assert.strictEqual(state.current_amount, 0n, 'a new campaign should have raised nothing');
            assert.strictEqual(state.duration, DURATION_DAYS, 'duration not recorded');
            assert.strictEqual(state.bump, success.bump, 'bump not recorded');
            assert.strictEqual(state.time_started, startedAt, 'start time not taken from the clock sysvar');

            // The vault is created empty and owned by the fundraiser PDA.
            const vault = svm.getAccount(success.vault);
            assert.isTrue(vault.exists, 'vault not created');
            const vaultAccount = getTokenDecoder().decode(vault.data);
            assert.strictEqual(vaultAccount.amount, 0n, 'a new vault should be empty');
            assert.strictEqual(vaultAccount.owner, success.fundraiser, 'the vault must be owned by the fundraiser PDA');
            assert.strictEqual(vaultAccount.mint, mint, 'vault holds the wrong mint');
        });

        it('rejects a target on a mint whose decimals overflow the minimum calculation', async () => {
            // Mint decimals are a u8 and SPL Token does not cap them, so a
            // campaign can be opened against a mint with decimals = 41. The
            // minimum target is 3^decimals, and 3^41 overflows u64: with
            // overflow-checks on in the release profile, an unchecked `pow`
            // aborts the program (ProgramFailedToComplete) instead of
            // returning. `checked_pow` turns that into a clean error.
            const oddMintKeypair = await generateKeyPairSigner();
            await createMint(svm, payer, oddMintKeypair, 41);

            const oddMaker = await generateKeyPairSigner();
            svm.airdrop(oddMaker.address, lamports(1_000_000_000n));
            const [oddFundraiser, oddBump] = await findFundraiserPda(programId, oddMaker.address);
            const oddVault = await findAta(oddMintKeypair.address, oddFundraiser);

            await expectProgramError(
                svm,
                payer,
                [
                    buildInitialize({
                        amount: 18_000_000_000_000_000_000n,
                        duration: DURATION_DAYS,
                        bump: oddBump,
                        maker: oddMaker,
                        mint: oddMintKeypair.address,
                        fundraiser: oddFundraiser,
                        vault: oddVault,
                        programId,
                    }),
                ],
                FundraiserError.InvalidAmount,
            );
        });

        it('rejects a fundraiser account that is not the derived PDA', async () => {
            // A caller substituting their own account for the fundraiser PDA
            // would otherwise get a program-owned account they control.
            const campaign = await makeCampaign();
            const impostor = await generateKeyPairSigner();
            await expectFailure(svm, payer, [
                buildInitialize({
                    amount: TARGET,
                    duration: DURATION_DAYS,
                    bump: campaign.bump,
                    maker: campaign.maker,
                    mint,
                    fundraiser: impostor.address,
                    vault: campaign.vault,
                    programId,
                }),
            ]);
        });
    });

    describe('Contribute', () => {
        it('rejects a zero contribution', async () => {
            await expectProgramError(
                svm,
                payer,
                [contributeIx(success, contributors[0], 0n)],
                FundraiserError.ContributionTooSmall,
            );
        });

        it('rejects a single contribution above the per-contributor cap', async () => {
            await expectProgramError(
                svm,
                payer,
                [contributeIx(success, contributors[0], CAP + 1n)],
                FundraiserError.ContributionTooBig,
            );
        });

        it('rejects a substitute vault', async () => {
            // A token account for the campaign mint owned by the fundraiser PDA
            // is creatable by anyone - a token account's owner field never needs
            // the owner to sign. Without the ATA derivation check, contributions
            // could be routed into an attacker-chosen account.
            const decoyVault = await generateKeyPairSigner();
            const tokenSize = BigInt(getTokenSize());
            await sendInstructions(svm, payer, [
                getCreateAccountInstruction({
                    payer,
                    newAccount: decoyVault,
                    space: tokenSize,
                    lamports: svm.minimumBalanceForRentExemption(tokenSize),
                    programAddress: TOKEN_PROGRAM_ADDRESS,
                }),
            ]);
            await sendInstructions(svm, payer, [
                getInitializeAccount3Instruction({
                    account: decoyVault.address,
                    mint,
                    owner: success.fundraiser,
                }),
            ]);

            await expectProgramError(
                svm,
                payer,
                [
                    buildContribute({
                        amount: CAP,
                        contributorBump: contributors[0].bump,
                        contributor: contributors[0].wallet,
                        mint,
                        fundraiser: success.fundraiser,
                        contributorAccount: contributors[0].account,
                        contributorAta: contributors[0].ata,
                        vault: decoyVault.address,
                        programId,
                    }),
                ],
                FundraiserError.InvalidAccount,
            );
        });

        it("rejects a contributor token account that is not the signer's own ATA", async () => {
            await expectProgramError(
                svm,
                payer,
                [
                    buildContribute({
                        amount: CAP,
                        contributorBump: contributors[0].bump,
                        contributor: contributors[0].wallet,
                        mint,
                        fundraiser: success.fundraiser,
                        contributorAccount: contributors[0].account,
                        contributorAta: contributors[1].ata,
                        vault: success.vault,
                        programId,
                    }),
                ],
                FundraiserError.InvalidAccount,
            );
        });

        it('rejects a contributor account that is not the derived PDA', async () => {
            await expectFailure(svm, payer, [
                buildContribute({
                    amount: CAP,
                    contributorBump: contributors[1].bump,
                    contributor: contributors[0].wallet,
                    mint,
                    fundraiser: success.fundraiser,
                    contributorAccount: contributors[1].account,
                    contributorAta: contributors[0].ata,
                    vault: success.vault,
                    programId,
                }),
            ]);
        });

        it('records a contribution and creates the contributor account', async () => {
            const balanceBefore = tokenBalance(contributors[0].ata);

            await sendInstructions(svm, payer, [contributeIx(success, contributors[0], 400_000n)]);

            assert.strictEqual(tokenBalance(success.vault), 400_000n, 'vault did not receive the contribution');
            assert.strictEqual(
                tokenBalance(contributors[0].ata),
                balanceBefore - 400_000n,
                'contribution not debited from the contributor',
            );
            assert.strictEqual(
                readFundraiser(success.fundraiser).current_amount,
                400_000n,
                'campaign total not updated',
            );
            assert.strictEqual(
                readContributor(contributors[0].account).amount,
                400_000n,
                'contributor total not updated',
            );
        });

        it('accumulates repeat contributions from the same wallet', async () => {
            await sendInstructions(svm, payer, [contributeIx(success, contributors[0], 600_000n)]);

            assert.strictEqual(tokenBalance(success.vault), CAP, 'vault total wrong after the second contribution');
            assert.strictEqual(
                readContributor(contributors[0].account).amount,
                CAP,
                'contributor total should accumulate across contributions',
            );
            assert.strictEqual(
                readFundraiser(success.fundraiser).current_amount,
                CAP,
                'campaign total should accumulate across contributions',
            );
        });

        it('rejects contributions that would push a wallet past the cap', async () => {
            // This wallet is already at the cap, so even one more base unit is
            // rejected - the cap is on the running total, not per transaction.
            await expectProgramError(
                svm,
                payer,
                [contributeIx(success, contributors[0], 1n)],
                FundraiserError.MaximumContributionsReached,
            );
        });
    });

    describe('CheckContributions', () => {
        it('rejects a payout while the target is unmet', async () => {
            await expectProgramError(
                svm,
                payer,
                [
                    buildCheckContributions({
                        maker: success.maker,
                        mint,
                        fundraiser: success.fundraiser,
                        vault: success.vault,
                        makerAta: success.makerAta,
                        programId,
                    }),
                ],
                FundraiserError.TargetNotMet,
            );
        });

        it('reaches the target with the remaining contributors', async () => {
            for (let i = 1; i < 10; i++) {
                await sendInstructions(svm, payer, [contributeIx(success, contributors[i], CAP)]);
            }

            assert.strictEqual(tokenBalance(success.vault), TARGET, 'vault should hold exactly the target');
            assert.strictEqual(
                readFundraiser(success.fundraiser).current_amount,
                TARGET,
                'campaign total should equal the target',
            );
        });

        it('rejects a non-maker signer', async () => {
            // The impostor signs, but the campaign records who its maker is.
            await expectProgramError(
                svm,
                payer,
                [
                    buildCheckContributions({
                        maker: contributors[0].wallet,
                        mint,
                        fundraiser: success.fundraiser,
                        vault: success.vault,
                        makerAta: await findAta(mint, contributors[0].wallet.address),
                        programId,
                    }),
                ],
                FundraiserError.InvalidAccount,
            );
        });

        it('pays the maker and closes the campaign once the target is met', async () => {
            await sendInstructions(svm, payer, [
                buildCheckContributions({
                    maker: success.maker,
                    mint,
                    fundraiser: success.fundraiser,
                    vault: success.vault,
                    makerAta: success.makerAta,
                    programId,
                }),
            ]);

            assert.strictEqual(tokenBalance(success.makerAta), TARGET, 'the maker should receive the full raise');
            assert.isFalse(svm.getAccount(success.vault).exists, 'the vault should be closed');
            assert.isFalse(svm.getAccount(success.fundraiser).exists, 'the fundraiser account should be closed');
        });
    });

    describe('Refund', () => {
        let deadline: bigint;

        before(async () => {
            // Both campaigns open before any clock warp, so their deadlines are
            // in the future at this point.
            await sendInstructions(svm, payer, [initializeIx(expired)]);
            await sendInstructions(svm, payer, [initializeIx(funded)]);

            await sendInstructions(svm, payer, [contributeIx(expired, expiredContributor, CAP)]);

            // Fill the second campaign all the way to its target.
            for (const contributor of fundedContributors) {
                await sendInstructions(svm, payer, [contributeIx(funded, contributor, CAP)]);
            }

            const state = readFundraiser(expired.fundraiser);
            deadline = state.time_started + BigInt(state.duration) * SECONDS_PER_DAY;
        });

        const refundIx = (campaign: Campaign, contributor: Contributor, contributorAta = contributor.ata) =>
            buildRefund({
                contributorBump: contributor.bump,
                contributor: contributor.wallet,
                mint,
                fundraiser: campaign.fundraiser,
                contributorAccount: contributor.account,
                contributorAta,
                vault: campaign.vault,
                programId,
            });

        it('rejects a refund before the campaign has ended', async () => {
            await expectProgramError(
                svm,
                payer,
                [refundIx(expired, expiredContributor)],
                FundraiserError.FundraiserNotEnded,
            );
        });

        it('closes to contributions exactly at the deadline', async () => {
            // Warps to the deadline itself, not past it, so this pins the
            // off-by-one: the campaign is over the moment `duration` days have
            // elapsed, not a second later.
            warpTo(svm, deadline);

            await expectProgramError(
                svm,
                payer,
                [contributeIx(expired, expiredContributor, 1n)],
                FundraiserError.FundraiserEnded,
            );
        });

        it('rejects a refund redirected to another wallet token account', async () => {
            // The contributor still signs, but the destination was swapped. Only
            // the ATA derivation check catches this.
            await expectProgramError(
                svm,
                payer,
                [refundIx(expired, expiredContributor, contributors[0].ata)],
                FundraiserError.InvalidAccount,
            );
        });

        it('refunds the contributor and closes their account', async () => {
            const balanceBefore = tokenBalance(expiredContributor.ata);

            await sendInstructions(svm, payer, [refundIx(expired, expiredContributor)]);

            assert.strictEqual(
                tokenBalance(expiredContributor.ata),
                balanceBefore + CAP,
                'the contributor should get their full contribution back',
            );
            assert.strictEqual(tokenBalance(expired.vault), 0n, 'the vault should be drained');
            assert.isFalse(
                svm.getAccount(expiredContributor.account).exists,
                'the contributor account should be closed',
            );
            assert.strictEqual(
                readFundraiser(expired.fundraiser).current_amount,
                0n,
                'the refund should be deducted from the campaign total',
            );
        });

        it('rejects a refund from a campaign that reached its target', async () => {
            // Expired, but fully funded: the raise belongs to the maker.
            await expectProgramError(svm, payer, [refundIx(funded, fundedContributors[0])], FundraiserError.TargetMet);
        });
    });
});
