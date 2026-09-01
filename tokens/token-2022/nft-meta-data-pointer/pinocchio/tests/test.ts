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
    unwrapOption,
} from '@solana/kit';
import { SYSTEM_PROGRAM_ADDRESS } from '@solana-program/system';
import {
    ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
    TOKEN_2022_PROGRAM_ADDRESS,
    findAssociatedTokenPda,
    getMintDecoder,
    getTokenDecoder,
} from '@solana-program/token-2022';
import { assert } from 'chai';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';

const INIT_PLAYER = 0;
const CHOP_TREE = 1;
const MINT_NFT = 2;

const LEVEL_SEED = 'level1';
const MAX_ENERGY = 100n;

const PROGRAM_SO = path.join(
    process.cwd(),
    'tests',
    'fixtures',
    'token_2022_nft_meta_data_pointer_pinocchio_program.so',
);
const addressEncoder = getAddressEncoder();

function concatBytes(...parts: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let offset = 0;
    for (const p of parts) {
        out.set(p, offset);
        offset += p.length;
    }
    return out;
}
function prefixed(value: string): Uint8Array {
    const bytes = new TextEncoder().encode(value);
    return concatBytes(Uint8Array.of(bytes.length), bytes);
}
function u16le(n: number): Uint8Array {
    return Uint8Array.of(n & 0xff, (n >> 8) & 0xff);
}

describe('Token-2022 NFT Metadata Pointer (Pinocchio)', () => {
    let svm: LiteSVM;
    let programId: Address;
    let player: KeyPairSigner;
    let playerAccount: Address;
    let gameData: Address;
    let nftAuthority: Address;
    let mint: KeyPairSigner;
    let tokenAccount: Address;

    before(async () => {
        svm = new LiteSVM();
        // The program derives every PDA from the id it is invoked with, so a
        // generated id keeps the test self-contained.
        programId = (await generateKeyPairSigner()).address;
        svm.addProgramFromFile(programId, PROGRAM_SO);

        player = await generateKeyPairSigner();
        svm.airdrop(player.address, lamports(10_000_000_000n));

        mint = await generateKeyPairSigner();

        [playerAccount] = await getProgramDerivedAddress({
            programAddress: programId,
            seeds: ['player', addressEncoder.encode(player.address)],
        });
        [gameData] = await getProgramDerivedAddress({ programAddress: programId, seeds: [LEVEL_SEED] });
        [nftAuthority] = await getProgramDerivedAddress({ programAddress: programId, seeds: ['nft_authority'] });
        [tokenAccount] = await findAssociatedTokenPda({
            owner: player.address,
            mint: mint.address,
            tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
        });
    });

    async function tx(
        instructions: Parameters<typeof appendTransactionMessageInstruction>[0][],
        feePayer: KeyPairSigner = player,
    ) {
        return signTransactionMessageWithSigners(
            pipe(
                createTransactionMessage({ version: 0 }),
                m => setTransactionMessageFeePayerSigner(feePayer, m),
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

    // player: authority(32) | level(1) | xp(8) | wood(8) | energy(8) | last_login(8) | last_id(2)
    function playerState() {
        const acc = svm.getAccount(playerAccount);
        if (!acc?.exists) throw new Error('player not found');
        const view = new DataView(acc.data.buffer, acc.data.byteOffset);
        return {
            authority: acc.data.slice(0, 32),
            wood: view.getBigUint64(41, true),
            energy: view.getBigUint64(49, true),
            lastLogin: view.getBigInt64(57, true),
            lastId: view.getUint16(65, true),
        };
    }

    function totalWood(): bigint {
        const acc = svm.getAccount(gameData);
        if (!acc?.exists) throw new Error('game data not found');
        return new DataView(acc.data.buffer, acc.data.byteOffset).getBigUint64(0, true);
    }

    function nftMetadata() {
        const acc = svm.getAccount(mint.address);
        if (!acc?.exists) throw new Error('mint not found');
        const state = getMintDecoder().decode(acc.data);
        const extensions = unwrapOption(state.extensions) ?? [];
        const metadata = extensions.find(e => e.__kind === 'TokenMetadata');
        if (metadata?.__kind !== 'TokenMetadata') throw new Error('TokenMetadata extension missing');
        return { state, extensions, metadata };
    }

    function mintIx(owner: KeyPairSigner, mintSigner: KeyPairSigner, ata: Address) {
        return {
            programAddress: programId,
            accounts: [
                { address: owner.address, role: AccountRole.WRITABLE_SIGNER, signer: owner },
                { address: mintSigner.address, role: AccountRole.WRITABLE_SIGNER, signer: mintSigner },
                { address: ata, role: AccountRole.WRITABLE },
                { address: nftAuthority, role: AccountRole.READONLY },
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
                { address: TOKEN_2022_PROGRAM_ADDRESS, role: AccountRole.READONLY },
                { address: ASSOCIATED_TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ],
            data: Uint8Array.of(MINT_NFT),
        };
    }

    function chopIx(
        counter: number,
        signer: KeyPairSigner = player,
        playerPda: Address = playerAccount,
        overrides: { mint?: Address; tokenAccount?: Address; tokenProgram?: Address } = {},
    ) {
        return {
            programAddress: programId,
            accounts: [
                { address: playerPda, role: AccountRole.WRITABLE },
                { address: gameData, role: AccountRole.WRITABLE },
                { address: signer.address, role: AccountRole.WRITABLE_SIGNER, signer },
                { address: overrides.mint ?? mint.address, role: AccountRole.WRITABLE },
                { address: overrides.tokenAccount ?? tokenAccount, role: AccountRole.READONLY },
                { address: nftAuthority, role: AccountRole.READONLY },
                { address: overrides.tokenProgram ?? TOKEN_2022_PROGRAM_ADDRESS, role: AccountRole.READONLY },
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ],
            data: concatBytes(Uint8Array.of(CHOP_TREE), u16le(counter), prefixed(LEVEL_SEED)),
        };
    }

    it('Initializes a player and the shared level', async () => {
        const ix = {
            programAddress: programId,
            accounts: [
                { address: playerAccount, role: AccountRole.WRITABLE },
                { address: gameData, role: AccountRole.WRITABLE },
                { address: player.address, role: AccountRole.WRITABLE_SIGNER, signer: player },
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ],
            data: concatBytes(Uint8Array.of(INIT_PLAYER), prefixed(LEVEL_SEED)),
        };
        send(await tx([ix]), 'init player');

        const state = playerState();
        assert.deepEqual(
            Array.from(state.authority),
            Array.from(addressEncoder.encode(player.address)),
            'authority recorded',
        );
        assert.equal(state.energy, MAX_ENERGY, 'starts with full energy');
        assert.equal(state.wood, 0n, 'starts with no wood');
        // LiteSVM's clock starts at zero, so assert against it rather than
        // assuming a wall-clock timestamp.
        assert.equal(state.lastLogin, svm.getClock().unixTimestamp, 'last login stamped from the clock');
        assert.equal(totalWood(), 0n, 'the level starts untouched');
    });

    it('Mints the NFT with its metadata in the mint', async () => {
        send(await tx([mintIx(player, mint, tokenAccount)]), 'mint nft');

        const { state, extensions, metadata } = nftMetadata();
        assert.equal(state.decimals, 0, 'an NFT is indivisible');
        assert.equal(state.supply, 1n, 'exactly one token exists');
        assert.isNull(unwrapOption(state.mintAuthority), 'minting was revoked, fixing the supply at one');

        // The pointer names the mint itself, which is why the metadata lives
        // in the mint account rather than a separate one.
        const pointer = extensions.find(e => e.__kind === 'MetadataPointer');
        if (pointer?.__kind !== 'MetadataPointer') throw new Error('MetadataPointer extension missing');
        assert.equal(unwrapOption(pointer.metadataAddress), mint.address, 'the pointer names the mint');
        assert.equal(unwrapOption(pointer.authority), nftAuthority, 'the program PDA owns the metadata');

        assert.equal(metadata.name, 'Beaver');
        assert.equal(metadata.symbol, 'BVA');
        assert.equal(metadata.updateAuthority ? unwrapOption(metadata.updateAuthority) : null, nftAuthority);
        assert.equal(metadata.additionalMetadata.get('level'), '1', 'level written at mint time');

        const token = svm.getAccount(tokenAccount);
        if (!token?.exists) throw new Error('token account not found');
        assert.equal(getTokenDecoder().decode(token.data).amount, 1n, 'the player holds the NFT');
    });

    it('Chopping spends energy, banks wood, and writes it onto the NFT', async () => {
        send(await tx([chopIx(1)]), 'chop 1');

        const state = playerState();
        assert.equal(state.wood, 1n, 'wood banked');
        assert.equal(state.energy, MAX_ENERGY - 1n, 'energy spent');
        assert.equal(state.lastId, 1, 'counter recorded');
        assert.equal(totalWood(), 1n, 'the level total advanced');

        // The point of the example: the token's own metadata is the live game
        // state, with nothing indexing this program.
        assert.equal(nftMetadata().metadata.additionalMetadata.get('wood'), '1', 'wood written onto the NFT');
    });

    it('Keeps the NFT current across several chops', async () => {
        for (const counter of [2, 3, 4]) {
            send(await tx([chopIx(counter)]), `chop ${counter}`);
        }

        const state = playerState();
        assert.equal(state.wood, 4n, 'four chops banked');
        assert.equal(state.energy, MAX_ENERGY - 4n, 'four energy spent');
        assert.equal(state.lastId, 4, 'the latest counter is recorded');
        assert.equal(totalWood(), 4n, 'the level total tracks every player');
        assert.equal(nftMetadata().metadata.additionalMetadata.get('wood'), '4', 'the NFT tracks the running total');
    });

    it("Rejects chopping with someone else's signature", async () => {
        // The reference gates this through its session-key macro's fallback
        // arm; with session keys dropped, the player's own signature is the
        // only way in. An impostor derives a different player PDA, so the
        // account they pass cannot be this player's.
        const impostor = await generateKeyPairSigner();
        svm.airdrop(impostor.address, lamports(1_000_000_000n));

        const result = svm.sendTransaction(await tx([chopIx(5, impostor)], impostor));
        assert.instanceOf(result, FailedTransactionMetadata, 'expected the impostor to be refused');
        assert.include(
            (result as FailedTransactionMetadata).meta().logs().join('\n'),
            'custom program error: 0x2',
            'rejected with InvalidSeeds',
        );
        assert.equal(playerState().wood, 4n, 'no wood was banked');
    });

    it("Rejects chopping another player's account", async () => {
        // Passing the real player's PDA while signing as someone else fails the
        // seed check first, and the authority check behind it.
        const impostor = await generateKeyPairSigner();
        svm.airdrop(impostor.address, lamports(1_000_000_000n));

        const result = svm.sendTransaction(await tx([chopIx(5, impostor, playerAccount)], impostor));
        assert.instanceOf(result, FailedTransactionMetadata, 'expected the impostor to be refused');
        assert.equal(playerState().wood, 4n, 'no wood was banked');
    });

    it('Refuses to chop with no energy left', async () => {
        // Drain the player rather than sending 100 transactions: energy sits at
        // offset 49, and last_login just after it, so a refill cannot quietly
        // top it back up within the test.
        const acc = svm.getAccount(playerAccount);
        if (!acc?.exists) throw new Error('player not found');
        const drained = new Uint8Array(acc.data);
        new DataView(drained.buffer).setBigUint64(49, 0n, true);
        new DataView(drained.buffer).setBigInt64(57, BigInt(Math.floor(Date.now() / 1000)) + 3600n, true);
        svm.setAccount({
            address: playerAccount,
            data: drained,
            executable: false,
            lamports: acc.lamports,
            programAddress: acc.programAddress,
            space: BigInt(drained.length),
        });

        svm.expireBlockhash();
        const result = svm.sendTransaction(await tx([chopIx(6)]));
        assert.instanceOf(result, FailedTransactionMetadata, 'expected the chop to be refused');
        assert.include(
            (result as FailedTransactionMetadata).meta().logs().join('\n'),
            'custom program error: 0x0',
            'rejected with NotEnoughEnergy',
        );
    });

    it('A second player shares the level but keeps their own progress', async () => {
        const second = await generateKeyPairSigner();
        svm.airdrop(second.address, lamports(10_000_000_000n));
        const [secondPlayer] = await getProgramDerivedAddress({
            programAddress: programId,
            seeds: ['player', addressEncoder.encode(second.address)],
        });

        const initIx = {
            programAddress: programId,
            accounts: [
                { address: secondPlayer, role: AccountRole.WRITABLE },
                { address: gameData, role: AccountRole.WRITABLE },
                { address: second.address, role: AccountRole.WRITABLE_SIGNER, signer: second },
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ],
            data: concatBytes(Uint8Array.of(INIT_PLAYER), prefixed(LEVEL_SEED)),
        };
        // The level already exists, so this must reuse it rather than fail
        // trying to recreate it.
        send(await tx([initIx], second), 'init second player');

        // Each player chops against their own NFT, so the second one needs a
        // mint of their own before they can play.
        const secondMint = await generateKeyPairSigner();
        const [secondAta] = await findAssociatedTokenPda({
            owner: second.address,
            mint: secondMint.address,
            tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
        });
        send(await tx([mintIx(second, secondMint, secondAta)], second), 'second player mints');

        const before = totalWood();
        send(
            await tx([chopIx(1, second, secondPlayer, { mint: secondMint.address, tokenAccount: secondAta })], second),
            'second player chops',
        );

        assert.equal(totalWood(), before + 1n, 'the shared level advanced');
        const acc = svm.getAccount(secondPlayer);
        if (!acc?.exists) throw new Error('second player not found');
        assert.equal(
            new DataView(acc.data.buffer, acc.data.byteOffset).getBigUint64(41, true),
            1n,
            'the second player has their own wood total',
        );
    });

    it("Refuses to rewrite another player's NFT", async () => {
        const impostor = await generateKeyPairSigner();
        svm.airdrop(impostor.address, lamports(10_000_000_000n));
        const [impostorPlayer] = await getProgramDerivedAddress({
            programAddress: programId,
            seeds: ['player', addressEncoder.encode(impostor.address)],
        });
        const impostorMint = await generateKeyPairSigner();
        const [impostorAta] = await findAssociatedTokenPda({
            owner: impostor.address,
            mint: impostorMint.address,
            tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
        });

        const initIx = {
            programAddress: programId,
            accounts: [
                { address: impostorPlayer, role: AccountRole.WRITABLE },
                { address: gameData, role: AccountRole.WRITABLE },
                { address: impostor.address, role: AccountRole.WRITABLE_SIGNER, signer: impostor },
                { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
            ],
            data: concatBytes(Uint8Array.of(INIT_PLAYER), prefixed(LEVEL_SEED)),
        };
        send(await tx([initIx], impostor), 'init impostor');
        send(await tx([mintIx(impostor, impostorMint, impostorAta)], impostor), 'impostor mints');

        // Every NFT this program mints answers to the same metadata authority,
        // so without the holding check a valid player could point chop_tree at
        // someone else's mint and overwrite its wood.
        const woodBefore = nftMetadata().metadata.additionalMetadata;
        const result = svm.sendTransaction(
            await tx([chopIx(9, impostor, impostorPlayer, { tokenAccount: impostorAta })], impostor),
        );
        assert.instanceOf(result, FailedTransactionMetadata, 'expected the foreign mint to be refused');
        assert.include(
            (result as FailedTransactionMetadata).meta().logs().join('\n'),
            'custom program error: 0x1',
            'rejected with WrongAuthority',
        );
        assert.deepEqual(nftMetadata().metadata.additionalMetadata, woodBefore, 'the victim NFT is untouched');
    });

    it('Refuses a token program that is not Token-2022', async () => {
        const result = svm.sendTransaction(
            await tx([chopIx(10, player, playerAccount, { tokenProgram: SYSTEM_PROGRAM_ADDRESS })]),
        );
        assert.instanceOf(result, FailedTransactionMetadata, 'expected the wrong token program to be refused');
        // Refused up front by the program, not incidentally by the CPI target:
        // the reference gets this from `Program<'info, Token2022>`.
        assert.include(
            (result as FailedTransactionMetadata).meta().logs().join('\n'),
            'incorrect program id',
            'rejected before the CPI is attempted',
        );
    });
});
