import * as anchor from '@anchor-lang/core';
import {
    AccountLayout,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    createAssociatedTokenAccountInstruction,
    createInitializeMint2Instruction,
    createMintToInstruction,
    getAssociatedTokenAddressSync,
    MINT_SIZE,
    TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { LiteSVMProvider } from 'anchor-litesvm';
import { assert } from 'chai';
import { LiteSVM } from 'litesvm';
import IDL from '../target/idl/nft_staking.json' with { type: 'json' };
import type { NftStaking } from '../target/types/nft_staking.ts';
import {
    createMasterEditionV3,
    createMetadataAccountV3,
    masterEditionPda,
    metadataPda,
    TOKEN_METADATA_PROGRAM_ID,
    verifyCollection,
} from './metaplex.ts';
import { expectAnchorError } from './utils.ts';

const PROGRAM_ID = new PublicKey(IDL.address);

const SECONDS_PER_DAY = 86_400n;

// Pool settings used throughout. max_stake is 1 so the cap is easy to hit.
const POINTS_PER_DAY = 10;
const MAX_STAKE = 1;
const FREEZE_PERIOD_DAYS = 2;
const REWARD_DECIMALS = 6;
const ONE_DAY_OF_REWARDS = BigInt(POINTS_PER_DAY) * 10n ** BigInt(REWARD_DECIMALS);

// SPL token account states.
const INITIALIZED = 1;
const FROZEN = 2;

describe('nft-staking litesvm', () => {
    const client = new LiteSVM();
    client.addProgramFromFile(PROGRAM_ID, 'target/deploy/nft_staking.so');
    client.addProgramFromFile(TOKEN_METADATA_PROGRAM_ID, 'tests/fixtures/token_metadata.so');
    const provider = new LiteSVMProvider(client);
    anchor.setProvider(provider);
    const wallet = provider.wallet as anchor.Wallet;
    const program = new anchor.Program<NftStaking>(IDL, provider);

    // The wallet is the pool admin and mints every NFT. `staker` is the person
    // actually staking, so the tests exercise a real second signer.
    const staker = Keypair.generate();
    const otherUser = Keypair.generate();
    const otherAdmin = Keypair.generate();

    // Pools are seeded by their admin, so the derivation includes the wallet.
    const config = PublicKey.findProgramAddressSync(
        [Buffer.from('config'), wallet.publicKey.toBuffer()],
        PROGRAM_ID,
    )[0];
    const rewardsMint = PublicKey.findProgramAddressSync([Buffer.from('rewards'), config.toBuffer()], PROGRAM_ID)[0];
    const userPda = (poolConfig: PublicKey, owner: PublicKey) =>
        PublicKey.findProgramAddressSync([Buffer.from('user'), poolConfig.toBuffer(), owner.toBuffer()], PROGRAM_ID)[0];

    const userAccount = userPda(config, staker.publicKey);

    // A second pool under a different admin, used to prove pools are isolated.
    const otherConfig = PublicKey.findProgramAddressSync(
        [Buffer.from('config'), otherAdmin.publicKey.toBuffer()],
        PROGRAM_ID,
    )[0];
    const otherRewardsMint = PublicKey.findProgramAddressSync(
        [Buffer.from('rewards'), otherConfig.toBuffer()],
        PROGRAM_ID,
    )[0];

    const stakePdaIn = (nftMint: PublicKey, poolConfig: PublicKey) =>
        PublicKey.findProgramAddressSync(
            [Buffer.from('stake'), nftMint.toBuffer(), poolConfig.toBuffer()],
            PROGRAM_ID,
        )[0];

    const stakePda = (nftMint: PublicKey) => stakePdaIn(nftMint, config);

    const tokenAccount = (address: PublicKey) => AccountLayout.decode(client.getAccount(address)!.data);

    const rewardsBalance = () => {
        const ata = getAssociatedTokenAddressSync(rewardsMint, staker.publicKey);
        const account = client.getAccount(ata);
        return account === null ? 0n : AccountLayout.decode(account.data).amount;
    };

    /** Moves the validator clock forward and lets identical transactions resend. */
    const warpDays = (days: number) => {
        const clock = client.getClock();
        clock.unixTimestamp += BigInt(Math.round(days * Number(SECONDS_PER_DAY)));
        client.setClock(clock);
        client.expireBlockhash();
    };

    /**
     * Mints a fresh NFT: mint account, one token to `owner`, metadata, and a
     * master edition (which moves the mint's freeze authority to the edition
     * PDA — the thing that makes freeze-in-place staking possible).
     */
    const createNft = async ({
        owner,
        collection,
        verify = false,
    }: {
        owner: PublicKey;
        collection?: PublicKey;
        verify?: boolean;
    }) => {
        const mintKeypair = Keypair.generate();
        const mint = mintKeypair.publicKey;
        const ata = getAssociatedTokenAddressSync(mint, owner);
        const lamports = await provider.connection.getMinimumBalanceForRentExemption(MINT_SIZE);

        const tx = new Transaction().add(
            SystemProgram.createAccount({
                fromPubkey: wallet.publicKey,
                newAccountPubkey: mint,
                space: MINT_SIZE,
                lamports,
                programId: TOKEN_PROGRAM_ID,
            }),
            createInitializeMint2Instruction(mint, 0, wallet.publicKey, wallet.publicKey),
            createAssociatedTokenAccountInstruction(wallet.publicKey, ata, owner, mint),
            // Supply must be exactly 1 before the master edition can be created.
            createMintToInstruction(mint, ata, wallet.publicKey, 1),
            createMetadataAccountV3({
                mint,
                mintAuthority: wallet.publicKey,
                payer: wallet.publicKey,
                updateAuthority: wallet.publicKey,
                name: 'Staking Test NFT',
                symbol: 'STK',
                uri: '',
                collection,
            }),
            createMasterEditionV3({
                mint,
                updateAuthority: wallet.publicKey,
                mintAuthority: wallet.publicKey,
                payer: wallet.publicKey,
            }),
        );

        if (collection && verify) {
            tx.add(
                verifyCollection({
                    mint,
                    collectionMint: collection,
                    collectionAuthority: wallet.publicKey,
                    payer: wallet.publicKey,
                }),
            );
        }

        await provider.sendAndConfirm(tx, [mintKeypair]);
        return { mint, ata };
    };

    const stakeAccounts = (nftMint: PublicKey, nftTokenAccount: PublicKey) => ({
        user: staker.publicKey,
        nftMint,
        nftTokenAccount,
        metadata: metadataPda(nftMint),
        edition: masterEditionPda(nftMint),
        config,
        stakeAccount: stakePda(nftMint),
        userAccount,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        metadataProgram: TOKEN_METADATA_PROGRAM_ID,
    });

    const claimAccounts = (nftMint: PublicKey, user: Keypair, users: PublicKey) => ({
        user: user.publicKey,
        nftMint,
        config,
        rewardsMint,
        rewardsTokenAccount: getAssociatedTokenAddressSync(rewardsMint, user.publicKey),
        stakeAccount: stakePda(nftMint),
        userAccount: users,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    });

    // NFTs used across the suite, filled in by the setup test.
    let collectionMint: PublicKey;
    let otherCollectionMint: PublicKey;
    let nftA: { mint: PublicKey; ata: PublicKey };
    let nftB: { mint: PublicKey; ata: PublicKey };
    let nftC: { mint: PublicKey; ata: PublicKey };
    let nftNotHeld: { mint: PublicKey; ata: PublicKey };
    let nftNoCollection: { mint: PublicKey; ata: PublicKey };
    let nftUnverified: { mint: PublicKey; ata: PublicKey };
    let nftWrongCollection: { mint: PublicKey; ata: PublicKey };
    let stakedAt: bigint;

    it('Test preparation - mints a collection and the NFTs each case needs', async () => {
        client.airdrop(staker.publicKey, BigInt(10 * LAMPORTS_PER_SOL));
        client.airdrop(otherUser.publicKey, BigInt(10 * LAMPORTS_PER_SOL));
        client.airdrop(otherAdmin.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

        collectionMint = (await createNft({ owner: wallet.publicKey })).mint;
        otherCollectionMint = (await createNft({ owner: wallet.publicKey })).mint;

        nftA = await createNft({ owner: staker.publicKey, collection: collectionMint, verify: true });
        nftB = await createNft({ owner: staker.publicKey, collection: collectionMint, verify: true });
        nftC = await createNft({ owner: staker.publicKey, collection: collectionMint, verify: true });
        nftNoCollection = await createNft({ owner: staker.publicKey });
        nftUnverified = await createNft({ owner: staker.publicKey, collection: collectionMint, verify: false });
        nftWrongCollection = await createNft({
            owner: staker.publicKey,
            collection: otherCollectionMint,
            verify: true,
        });

        // Held by the wallet, not the staker. The staker still gets an (empty)
        // associated token account for it, which is the whole point of the
        // "does not hold the NFT" case below.
        const held = await createNft({ owner: wallet.publicKey, collection: collectionMint, verify: true });
        const emptyAta = getAssociatedTokenAddressSync(held.mint, staker.publicKey);
        await provider.sendAndConfirm(
            new Transaction().add(
                createAssociatedTokenAccountInstruction(wallet.publicKey, emptyAta, staker.publicKey, held.mint),
            ),
        );
        nftNotHeld = { mint: held.mint, ata: emptyAta };

        assert.strictEqual(tokenAccount(nftA.ata).amount, 1n, 'staker should hold nftA');
        assert.strictEqual(tokenAccount(nftNotHeld.ata).amount, 0n, 'staker should not hold nftNotHeld');
    });

    it('Initializes the pool and its reward mint', async () => {
        await program.methods
            .initializeConfig(new anchor.BN(POINTS_PER_DAY), MAX_STAKE, FREEZE_PERIOD_DAYS, REWARD_DECIMALS)
            .accountsPartial({
                admin: wallet.publicKey,
                collectionMint,
                config,
                rewardsMint,
                systemProgram: SystemProgram.programId,
                tokenProgram: TOKEN_PROGRAM_ID,
            })
            .rpc();

        const configAccount = await program.account.stakeConfig.fetch(config);
        assert.strictEqual(configAccount.collection.toBase58(), collectionMint.toBase58());
        assert.strictEqual(configAccount.pointsPerDay.toNumber(), POINTS_PER_DAY);
        assert.strictEqual(configAccount.maxStake, MAX_STAKE);
        assert.strictEqual(configAccount.freezePeriodDays, FREEZE_PERIOD_DAYS);

        // The reward mint must be controlled by the program, not the admin -
        // otherwise the admin could mint rewards out of thin air.
        const mintAccount = client.getAccount(rewardsMint)!;
        assert.strictEqual(new PublicKey(mintAccount.data.subarray(4, 36)).toBase58(), config.toBase58());
    });

    // A pool is seeded by its admin, so initializing one never blocks anyone
    // else from running their own.
    it('Lets a second admin run their own pool', async () => {
        await program.methods
            .initializeConfig(new anchor.BN(POINTS_PER_DAY), MAX_STAKE, FREEZE_PERIOD_DAYS, REWARD_DECIMALS)
            .accountsPartial({
                admin: otherAdmin.publicKey,
                collectionMint,
                config: otherConfig,
                rewardsMint: otherRewardsMint,
                systemProgram: SystemProgram.programId,
                tokenProgram: TOKEN_PROGRAM_ID,
            })
            .signers([otherAdmin])
            .rpc();

        const account = await program.account.stakeConfig.fetch(otherConfig);
        assert.strictEqual(account.admin.toBase58(), otherAdmin.publicKey.toBase58());
    });

    // `unstake` settles rewards before it thaws, so a rate that can overflow
    // would strand the NFT frozen. These have to be rejected up front.
    it('Rejects pool settings that would strand a staked NFT', async () => {
        const badAdmin = Keypair.generate();
        client.airdrop(badAdmin.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

        const badConfig = PublicKey.findProgramAddressSync(
            [Buffer.from('config'), badAdmin.publicKey.toBuffer()],
            PROGRAM_ID,
        )[0];
        const badRewardsMint = PublicKey.findProgramAddressSync(
            [Buffer.from('rewards'), badConfig.toBuffer()],
            PROGRAM_ID,
        )[0];

        const initWith = (pointsPerDay: number | bigint, maxStake: number, decimals: number) =>
            program.methods
                .initializeConfig(new anchor.BN(pointsPerDay.toString()), maxStake, FREEZE_PERIOD_DAYS, decimals)
                .accountsPartial({
                    admin: badAdmin.publicKey,
                    collectionMint,
                    config: badConfig,
                    rewardsMint: badRewardsMint,
                    systemProgram: SystemProgram.programId,
                    tokenProgram: TOKEN_PROGRAM_ID,
                })
                .signers([badAdmin])
                .rpc();

        // A pool nobody can stake in.
        await expectAnchorError(initWith(POINTS_PER_DAY, 0, REWARD_DECIMALS), 'InvalidConfig');

        client.expireBlockhash();
        // More decimals than an SPL mint conventionally carries.
        await expectAnchorError(initWith(POINTS_PER_DAY, MAX_STAKE, 20), 'InvalidConfig');

        client.expireBlockhash();
        // Scaled payout that overflows u64 well inside the pool's lifetime.
        await expectAnchorError(initWith(2n ** 60n, MAX_STAKE, REWARD_DECIMALS), 'InvalidConfig');

        assert.isNull(client.getAccount(badConfig), 'no config should have been created');
    });

    it('Initializes the user accounts', async () => {
        await program.methods
            .initializeUser()
            .accountsPartial({
                user: staker.publicKey,
                config,
                userAccount,
                systemProgram: SystemProgram.programId,
            })
            .signers([staker])
            .rpc();

        await program.methods
            .initializeUser()
            .accountsPartial({
                user: otherUser.publicKey,
                config,
                userAccount: userPda(config, otherUser.publicKey),
                systemProgram: SystemProgram.programId,
            })
            .signers([otherUser])
            .rpc();

        const account = await program.account.userAccount.fetch(userAccount);
        assert.strictEqual(account.amountStaked, 0);
        assert.strictEqual(account.pointsEarned.toNumber(), 0);
    });

    // Both `approve` and the Metaplex freeze succeed on a zero-balance token
    // account, so without an explicit balance check anyone could open an empty
    // ATA for a collection NFT and farm rewards from an NFT they never owned.
    it('Rejects staking an NFT the signer does not actually hold', async () => {
        await expectAnchorError(
            program.methods
                .stake()
                .accountsPartial(stakeAccounts(nftNotHeld.mint, nftNotHeld.ata))
                .signers([staker])
                .rpc(),
            'NftNotHeld',
        );
    });

    it('Rejects an NFT with no collection at all', async () => {
        await expectAnchorError(
            program.methods
                .stake()
                .accountsPartial(stakeAccounts(nftNoCollection.mint, nftNoCollection.ata))
                .signers([staker])
                .rpc(),
            'MissingCollection',
        );
    });

    it('Rejects an NFT whose collection is unverified', async () => {
        await expectAnchorError(
            program.methods
                .stake()
                .accountsPartial(stakeAccounts(nftUnverified.mint, nftUnverified.ata))
                .signers([staker])
                .rpc(),
            'UnverifiedCollection',
        );
    });

    it('Rejects an NFT from a different collection', async () => {
        await expectAnchorError(
            program.methods
                .stake()
                .accountsPartial(stakeAccounts(nftWrongCollection.mint, nftWrongCollection.ata))
                .signers([staker])
                .rpc(),
            'InvalidCollection',
        );
    });

    it('Stakes an NFT by freezing it in the owner wallet', async () => {
        await program.methods.stake().accountsPartial(stakeAccounts(nftA.mint, nftA.ata)).signers([staker]).rpc();

        const stake = await program.account.stakeAccount.fetch(stakePda(nftA.mint));
        stakedAt = BigInt(stake.stakedAt.toString());
        assert.strictEqual(stake.owner.toBase58(), staker.publicKey.toBase58());
        assert.strictEqual(stake.mint.toBase58(), nftA.mint.toBase58());
        assert.strictEqual(
            stake.lastClaimedAt.toString(),
            stake.stakedAt.toString(),
            'accrual must start at the moment of staking',
        );

        // The NFT is frozen but still owned by, and sitting in, the staker's
        // own token account - the program never took custody of it.
        const nft = tokenAccount(nftA.ata);
        assert.strictEqual(nft.state, FROZEN, 'the NFT token account should be frozen');
        assert.strictEqual(nft.amount, 1n, 'the NFT should still be in the staker wallet');
        assert.strictEqual(nft.owner.toBase58(), staker.publicKey.toBase58());
        assert.strictEqual(nft.delegateOption, 1, 'the stake account should be the delegate');
        assert.strictEqual(nft.delegate.toBase58(), stakePda(nftA.mint).toBase58());

        const account = await program.account.userAccount.fetch(userAccount);
        assert.strictEqual(account.amountStaked, 1);
    });

    it('Enforces the per-user stake cap', async () => {
        await expectAnchorError(
            program.methods.stake().accountsPartial(stakeAccounts(nftB.mint, nftB.ata)).signers([staker]).rpc(),
            'MaxStakeReached',
        );
    });

    // The cap and the points total live on a per-pool account, so being maxed
    // out in one pool must not affect another pool run by a different admin.
    it('Enforces stake caps per pool, not globally', async () => {
        const otherUserAccount = userPda(otherConfig, staker.publicKey);

        await program.methods
            .initializeUser()
            .accountsPartial({
                user: staker.publicKey,
                config: otherConfig,
                userAccount: otherUserAccount,
                systemProgram: SystemProgram.programId,
            })
            .signers([staker])
            .rpc();

        // Already at max_stake in the first pool; this must still go through.
        await program.methods
            .stake()
            .accountsPartial({
                user: staker.publicKey,
                nftMint: nftC.mint,
                nftTokenAccount: nftC.ata,
                metadata: metadataPda(nftC.mint),
                edition: masterEditionPda(nftC.mint),
                config: otherConfig,
                stakeAccount: stakePdaIn(nftC.mint, otherConfig),
                userAccount: otherUserAccount,
                systemProgram: SystemProgram.programId,
                tokenProgram: TOKEN_PROGRAM_ID,
                metadataProgram: TOKEN_METADATA_PROGRAM_ID,
            })
            .signers([staker])
            .rpc();

        assert.strictEqual(tokenAccount(nftC.ata).state, FROZEN, 'the second pool should have staked the NFT');
        assert.strictEqual(
            (await program.account.userAccount.fetch(otherUserAccount)).amountStaked,
            1,
            'the second pool tracks its own count',
        );
        assert.strictEqual(
            (await program.account.userAccount.fetch(userAccount)).amountStaked,
            1,
            'the first pool is unaffected',
        );
    });

    it('Pays nothing before a whole day has passed', async () => {
        await expectAnchorError(
            program.methods
                .claim()
                .accountsPartial(claimAccounts(nftA.mint, staker, userAccount))
                .signers([staker])
                .rpc(),
            'NothingToClaim',
        );
        assert.strictEqual(rewardsBalance(), 0n, 'a rejected claim must not mint anything');
    });

    it('Pays one day of rewards after one day', async () => {
        warpDays(1);

        await program.methods
            .claim()
            .accountsPartial(claimAccounts(nftA.mint, staker, userAccount))
            .signers([staker])
            .rpc();

        assert.strictEqual(rewardsBalance(), ONE_DAY_OF_REWARDS, 'one day staked should pay one day of rewards');

        const stake = await program.account.stakeAccount.fetch(stakePda(nftA.mint));
        assert.strictEqual(
            BigInt(stake.lastClaimedAt.toString()),
            stakedAt + SECONDS_PER_DAY,
            'the checkpoint should advance by exactly the day that was paid for',
        );

        const account = await program.account.userAccount.fetch(userAccount);
        assert.strictEqual(account.pointsEarned.toNumber(), POINTS_PER_DAY);
    });

    // The core hazard of any accrual-over-time program: if a payout read the
    // elapsed time but failed to record that it had paid for it, this second
    // call would pay for the same day again.
    it('Refuses to pay the same day twice', async () => {
        const balanceBefore = rewardsBalance();
        client.expireBlockhash();

        await expectAnchorError(
            program.methods
                .claim()
                .accountsPartial(claimAccounts(nftA.mint, staker, userAccount))
                .signers([staker])
                .rpc(),
            'NothingToClaim',
        );

        assert.strictEqual(rewardsBalance(), balanceBefore, 'a repeated claim must not mint a second payout');
    });

    it("Rejects a claim against another user's stake position", async () => {
        const otherUserAccount = userPda(config, otherUser.publicKey);

        await expectAnchorError(
            program.methods
                .claim()
                .accountsPartial(claimAccounts(nftA.mint, otherUser, otherUserAccount))
                .signers([otherUser])
                .rpc(),
            'InvalidOwner',
        );
    });

    it('Refuses to unstake before the freeze period has elapsed', async () => {
        // One day in, against a two-day freeze period.
        await expectAnchorError(
            program.methods
                .unstake()
                .accountsPartial({
                    user: staker.publicKey,
                    nftMint: nftA.mint,
                    nftTokenAccount: nftA.ata,
                    metadata: metadataPda(nftA.mint),
                    edition: masterEditionPda(nftA.mint),
                    config,
                    rewardsMint,
                    rewardsTokenAccount: getAssociatedTokenAddressSync(rewardsMint, staker.publicKey),
                    stakeAccount: stakePda(nftA.mint),
                    userAccount,
                    systemProgram: SystemProgram.programId,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                    metadataProgram: TOKEN_METADATA_PROGRAM_ID,
                })
                .signers([staker])
                .rpc(),
            'FreezePeriodNotPassed',
        );

        assert.strictEqual(tokenAccount(nftA.ata).state, FROZEN, 'a rejected unstake must leave the NFT frozen');
    });

    // Only whole days pay out. If a claim snapped its checkpoint to `now`
    // instead of advancing it by the days it actually paid for, the leftover
    // half day here would be swallowed and the next claim would come up short.
    it('Banks the part-day remainder instead of forfeiting it', async () => {
        warpDays(1.5);

        await program.methods
            .claim()
            .accountsPartial(claimAccounts(nftA.mint, staker, userAccount))
            .signers([staker])
            .rpc();

        assert.strictEqual(rewardsBalance(), 2n * ONE_DAY_OF_REWARDS, 'one and a half days should pay one day');

        const stake = await program.account.stakeAccount.fetch(stakePda(nftA.mint));
        assert.strictEqual(
            BigInt(stake.lastClaimedAt.toString()),
            stakedAt + 2n * SECONDS_PER_DAY,
            'the checkpoint should sit on the day boundary, not on `now`',
        );

        // Only another half day passes, but combined with the banked remainder
        // that is a full day - so it must pay out.
        warpDays(0.5);

        await program.methods
            .claim()
            .accountsPartial(claimAccounts(nftA.mint, staker, userAccount))
            .signers([staker])
            .rpc();

        assert.strictEqual(
            rewardsBalance(),
            3n * ONE_DAY_OF_REWARDS,
            'the half day banked earlier should combine with this one and pay out',
        );
    });

    it('Unstakes, settling the final rewards and returning the NFT', async () => {
        warpDays(1);

        const rentBefore = client.getBalance(staker.publicKey)!;
        const stakeAccountLamports = client.getAccount(stakePda(nftA.mint))!.lamports;

        await program.methods
            .unstake()
            .accountsPartial({
                user: staker.publicKey,
                nftMint: nftA.mint,
                nftTokenAccount: nftA.ata,
                metadata: metadataPda(nftA.mint),
                edition: masterEditionPda(nftA.mint),
                config,
                rewardsMint,
                rewardsTokenAccount: getAssociatedTokenAddressSync(rewardsMint, staker.publicKey),
                stakeAccount: stakePda(nftA.mint),
                userAccount,
                systemProgram: SystemProgram.programId,
                tokenProgram: TOKEN_PROGRAM_ID,
                associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                metadataProgram: TOKEN_METADATA_PROGRAM_ID,
            })
            .signers([staker])
            .rpc();

        // The last day is settled by the unstake itself, so nothing is lost by
        // unstaking without claiming first.
        assert.strictEqual(rewardsBalance(), 4n * ONE_DAY_OF_REWARDS, 'unstake should settle the outstanding day');

        const nft = tokenAccount(nftA.ata);
        assert.strictEqual(nft.state, INITIALIZED, 'the NFT should be thawed');
        assert.strictEqual(nft.amount, 1n, 'the NFT should still be in the staker wallet');
        assert.strictEqual(nft.delegateOption, 0, 'the delegate should be revoked');

        assert.isNull(client.getAccount(stakePda(nftA.mint)), 'the stake account should be closed');
        assert.isAbove(
            Number(client.getBalance(staker.publicKey)!),
            Number(rentBefore),
            'closing the stake position should return its rent',
        );
        assert.isAbove(stakeAccountLamports, 0, 'the stake account should have held rent while open');

        const account = await program.account.userAccount.fetch(userAccount);
        assert.strictEqual(account.amountStaked, 0);
        assert.strictEqual(account.pointsEarned.toNumber(), 4 * POINTS_PER_DAY);
    });

    it('Can stake again after unstaking', async () => {
        client.expireBlockhash();

        await program.methods.stake().accountsPartial(stakeAccounts(nftB.mint, nftB.ata)).signers([staker]).rpc();

        assert.strictEqual(tokenAccount(nftB.ata).state, FROZEN, 'the freed slot should allow a new stake');
    });
});
