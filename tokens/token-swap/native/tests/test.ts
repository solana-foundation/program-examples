import {
    appendTransactionMessageInstruction,
    createTransactionMessage,
    generateKeyPairSigner,
    type Instruction,
    type KeyPairSigner,
    lamports,
    pipe,
    setTransactionMessageFeePayerSigner,
    signTransactionMessageWithSigners,
} from '@solana/kit';
import {
    getCreateAssociatedTokenIdempotentInstruction,
    getInitializeMint2Instruction,
    getMintToInstruction,
    findAssociatedTokenPda,
    TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token';
import { getCreateAccountInstruction } from '@solana-program/system';
import { assert } from 'chai';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';
import { ammDecoder, poolDecoder } from './account';
import {
    buildCreateAmm,
    buildCreatePool,
    buildDepositLiquidity,
    buildWithdrawLiquidity,
    buildSwapExactTokensForTokens,
} from './instruction';
import {
    deriveAmmPda,
    derivePoolPda,
    derivePoolAuthorityPda,
    deriveMintLiquidityPda,
} from './utils';

const LAMPORTS_PER_SOL = 1_000_000_000n;

describe('Token Swap Native', () => {
    const svm = new LiteSVM();
    let payer: KeyPairSigner;
    let admin: KeyPairSigner;
    let trader: KeyPairSigner;
    let programId: KeyPairSigner;

    let mintA: KeyPairSigner;
    let mintB: KeyPairSigner;

    before(async () => {
        programId = await generateKeyPairSigner();
        svm.addProgramFromFile(programId.address, 'tests/fixtures/token_swap_native_program.so');

        payer = await generateKeyPairSigner();
        admin = await generateKeyPairSigner();
        trader = await generateKeyPairSigner();
        mintA = await generateKeyPairSigner();
        mintB = await generateKeyPairSigner();

        svm.airdrop(payer.address, lamports(100n * LAMPORTS_PER_SOL));
        svm.airdrop(admin.address, lamports(10n * LAMPORTS_PER_SOL));
        svm.airdrop(trader.address, lamports(10n * LAMPORTS_PER_SOL));
    });

    async function sendTx(ix: Instruction | Instruction[]) {
        const ixs = Array.isArray(ix) ? ix : [ix];
        let message = pipe(
            createTransactionMessage({ version: 0 }),
            m => setTransactionMessageFeePayerSigner(payer, m),
            m => svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
        );
        for (const i of ixs) {
            message = appendTransactionMessageInstruction(i, message);
        }
        const signed = await signTransactionMessageWithSigners(message);
        const res = svm.sendTransaction(signed);
        assert(!(res instanceof FailedTransactionMetadata), `Tx failed: ${res.toString()}`);
        return res;
    }

    it('creates AMM and pool', async () => {
        const ammId = (await generateKeyPairSigner()).address;
        const ammPda = await deriveAmmPda(ammId, programId.address);

        // 1. Create AMM
        await sendTx(buildCreateAmm({
            id: ammId,
            fee: 30, // 0.30%
            amm: ammPda,
            admin: admin.address,
            payer,
            programId: programId.address,
        }));

        const ammAccount = svm.getAccount(ammPda);
        assert.isNotNull(ammAccount);
        const decodedAmm = ammDecoder.decode(new Uint8Array(ammAccount!.data));
        assert.equal(decodedAmm.fee, 30);
        assert.equal(decodedAmm.id, ammId);

        // 2. Setup Mints A and B
        const rentExemptMint = 1_461_600n;
        await sendTx([
            getCreateAccountInstruction({
                payer,
                newAccount: mintA,
                lamports: rentExemptMint,
                space: 82n,
                programAddress: TOKEN_PROGRAM_ADDRESS,
            }),
            getInitializeMint2Instruction({
                mint: mintA.address,
                decimals: 6,
                mintAuthority: payer.address,
            }),
            getCreateAccountInstruction({
                payer,
                newAccount: mintB,
                lamports: rentExemptMint,
                space: 82n,
                programAddress: TOKEN_PROGRAM_ADDRESS,
            }),
            getInitializeMint2Instruction({
                mint: mintB.address,
                decimals: 6,
                mintAuthority: payer.address,
            }),
        ]);

        // 3. Create Pool
        const poolPda = await derivePoolPda(ammPda, mintA.address, mintB.address, programId.address);
        const poolAuth = await derivePoolAuthorityPda(ammPda, mintA.address, mintB.address, programId.address);
        const mintLp = await deriveMintLiquidityPda(ammPda, mintA.address, mintB.address, programId.address);

        const [poolAtaA] = await findAssociatedTokenPda({ mint: mintA.address, owner: poolAuth, tokenProgram: TOKEN_PROGRAM_ADDRESS });
        const [poolAtaB] = await findAssociatedTokenPda({ mint: mintB.address, owner: poolAuth, tokenProgram: TOKEN_PROGRAM_ADDRESS });

        await sendTx(buildCreatePool({
            amm: ammPda,
            pool: poolPda,
            poolAuthority: poolAuth,
            mintLiquidity: mintLp,
            mintA: mintA.address,
            mintB: mintB.address,
            poolAccountA: poolAtaA,
            poolAccountB: poolAtaB,
            payer,
            programId: programId.address,
        }));

        const poolAccount = svm.getAccount(poolPda);
        assert.isNotNull(poolAccount);
        const decodedPool = poolDecoder.decode(new Uint8Array(poolAccount!.data));
        assert.equal(decodedPool.amm, ammPda);
        assert.equal(decodedPool.mint_a, mintA.address);
        assert.equal(decodedPool.mint_b, mintB.address);
    });

    it('deposits initial liquidity and performs swap', async () => {
        const ammId = (await generateKeyPairSigner()).address;
        const ammPda = await deriveAmmPda(ammId, programId.address);

        await sendTx(buildCreateAmm({
            id: ammId,
            fee: 30,
            amm: ammPda,
            admin: admin.address,
            payer,
            programId: programId.address,
        }));

        const poolPda = await derivePoolPda(ammPda, mintA.address, mintB.address, programId.address);
        const poolAuth = await derivePoolAuthorityPda(ammPda, mintA.address, mintB.address, programId.address);
        const mintLp = await deriveMintLiquidityPda(ammPda, mintA.address, mintB.address, programId.address);

        const [poolAtaA] = await findAssociatedTokenPda({ mint: mintA.address, owner: poolAuth, tokenProgram: TOKEN_PROGRAM_ADDRESS });
        const [poolAtaB] = await findAssociatedTokenPda({ mint: mintB.address, owner: poolAuth, tokenProgram: TOKEN_PROGRAM_ADDRESS });

        await sendTx(buildCreatePool({
            amm: ammPda,
            pool: poolPda,
            poolAuthority: poolAuth,
            mintLiquidity: mintLp,
            mintA: mintA.address,
            mintB: mintB.address,
            poolAccountA: poolAtaA,
            poolAccountB: poolAtaB,
            payer,
            programId: programId.address,
        }));

        // Mint token A and B to payer (as depositor)
        const [payerAtaA] = await findAssociatedTokenPda({ mint: mintA.address, owner: payer.address, tokenProgram: TOKEN_PROGRAM_ADDRESS });
        const [payerAtaB] = await findAssociatedTokenPda({ mint: mintB.address, owner: payer.address, tokenProgram: TOKEN_PROGRAM_ADDRESS });
        const [payerAtaLp] = await findAssociatedTokenPda({ mint: mintLp, owner: payer.address, tokenProgram: TOKEN_PROGRAM_ADDRESS });

        await sendTx([
            getCreateAssociatedTokenIdempotentInstruction({ payer, ata: payerAtaA, mint: mintA.address, owner: payer.address }),
            getCreateAssociatedTokenIdempotentInstruction({ payer, ata: payerAtaB, mint: mintB.address, owner: payer.address }),
            getMintToInstruction({ mint: mintA.address, token: payerAtaA, mintAuthority: payer, amount: 10_000_000n }),
            getMintToInstruction({ mint: mintB.address, token: payerAtaB, mintAuthority: payer, amount: 10_000_000n }),
        ]);

        await sendTx([
            getCreateAssociatedTokenIdempotentInstruction({ payer, ata: payerAtaLp, mint: mintLp, owner: payer.address }),
        ]);

        // Deposit liquidity: 1,000,000 token A, 1,000,000 token B
        await sendTx(buildDepositLiquidity({
            pool: poolPda,
            poolAuthority: poolAuth,
            depositor: payer,
            mintLiquidity: mintLp,
            mintA: mintA.address,
            mintB: mintB.address,
            poolAccountA: poolAtaA,
            poolAccountB: poolAtaB,
            depositorAccountLiquidity: payerAtaLp,
            depositorAccountA: payerAtaA,
            depositorAccountB: payerAtaB,
            payer,
            amountA: 1_000_000n,
            amountB: 1_000_000n,
            programId: programId.address,
        }));

        // Trader swaps token A for token B
        const [traderAtaA] = await findAssociatedTokenPda({ mint: mintA.address, owner: trader.address, tokenProgram: TOKEN_PROGRAM_ADDRESS });
        const [traderAtaB] = await findAssociatedTokenPda({ mint: mintB.address, owner: trader.address, tokenProgram: TOKEN_PROGRAM_ADDRESS });

        await sendTx([
            getCreateAssociatedTokenIdempotentInstruction({ payer, ata: traderAtaA, mint: mintA.address, owner: trader.address }),
            getCreateAssociatedTokenIdempotentInstruction({ payer, ata: traderAtaB, mint: mintB.address, owner: trader.address }),
            getMintToInstruction({ mint: mintA.address, token: traderAtaA, mintAuthority: payer, amount: 50_000n }),
        ]);

        await sendTx(buildSwapExactTokensForTokens({
            amm: ammPda,
            pool: poolPda,
            poolAuthority: poolAuth,
            trader,
            mintA: mintA.address,
            mintB: mintB.address,
            poolAccountA: poolAtaA,
            poolAccountB: poolAtaB,
            traderAccountA: traderAtaA,
            traderAccountB: traderAtaB,
            payer,
            swapA: true,
            inputAmount: 10_000n,
            minOutputAmount: 9_000n,
            programId: programId.address,
        }));

        console.log("Token swap executed successfully!");

        // 5. Test Withdraw Liquidity
        await sendTx(buildWithdrawLiquidity({
            pool: poolPda,
            poolAuthority: poolAuth,
            depositor: payer,
            mintLiquidity: mintLp,
            mintA: mintA.address,
            mintB: mintB.address,
            poolAccountA: poolAtaA,
            poolAccountB: poolAtaB,
            depositorAccountLiquidity: payerAtaLp,
            depositorAccountA: payerAtaA,
            depositorAccountB: payerAtaB,
            payer,
            amount: 50_000n,
            programId: programId.address,
        }));

        console.log("Liquidity withdrawal executed successfully!");
    });
});
