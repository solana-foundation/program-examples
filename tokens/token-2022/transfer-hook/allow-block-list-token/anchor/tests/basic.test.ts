import * as path from 'node:path';
import {
    appendTransactionMessageInstructions,
    createTransactionMessage,
    generateKeyPairSigner,
    lamports,
    pipe,
    setTransactionMessageFeePayerSigner,
    signTransactionMessageWithSigners,
    type Instruction,
    type KeyPairSigner,
} from '@solana/kit';
import { assert } from 'chai';
import { FailedTransactionMetadata, LiteSVM } from 'litesvm';
import { decodeABWallet } from '../../src/generated/accounts/aBWallet';
import { decodeConfig } from '../../src/generated/accounts/config';
import {
    getInitConfigInstructionAsync,
    getInitWalletInstructionAsync,
    getRemoveWalletInstructionAsync,
} from '../../src/generated/instructions';
import { findAbWalletPda, findConfigPda } from '../../src/generated/pdas';
import { ABL_TOKEN_PROGRAM_ADDRESS } from '../../src/generated/programs';

// Exercises the Codama-generated Kit client - the same client the webapp uses - against a
// LiteSVM instance loaded with the built program, covering the generated instruction
// builders, PDA derivation, and account decoders. LiteSVM keeps the suite independent of a
// validator, whose ephemeral program id would not match the client's `declare_id!`.
const PROGRAM_SO = path.join(__dirname, '..', 'target', 'deploy', 'abl_token.so');

describe('abl-token (Kit client, via LiteSVM)', () => {
    let svm: LiteSVM;
    let authority: KeyPairSigner;

    before(async () => {
        svm = new LiteSVM();
        svm.addProgramFromFile(ABL_TOKEN_PROGRAM_ADDRESS, PROGRAM_SO);
        authority = await generateKeyPairSigner();
        svm.airdrop(authority.address, lamports(BigInt(10_000_000_000)));
    });

    async function send(instructions: Instruction | Instruction[], payer: KeyPairSigner = authority) {
        const transactionMessage = pipe(
            createTransactionMessage({ version: 0 }),
            m => setTransactionMessageFeePayerSigner(payer, m),
            m => svm.setTransactionMessageLifetimeUsingLatestBlockhash(m),
            m => appendTransactionMessageInstructions(Array.isArray(instructions) ? instructions : [instructions], m),
        );
        const signedTransaction = await signTransactionMessageWithSigners(transactionMessage);
        const result = svm.sendTransaction(signedTransaction);
        if (result instanceof FailedTransactionMetadata) {
            throw new Error(`Transaction failed: ${result.toString()}`);
        }
        return result;
    }

    it('initializes the config, owned by the payer', async () => {
        const ix = await getInitConfigInstructionAsync(
            { payer: authority },
            { programAddress: ABL_TOKEN_PROGRAM_ADDRESS },
        );
        await send(ix);

        const [configPda] = await findConfigPda({ programAddress: ABL_TOKEN_PROGRAM_ADDRESS });
        const account = svm.getAccount(configPda);
        if (!account?.exists) throw new Error('Config account not found');

        const config = decodeConfig({ ...account, address: configPda });
        assert.equal(config.data.authority, authority.address);
    });

    it('adds a wallet to the list, then removes it by wallet address alone', async () => {
        const wallet = await generateKeyPairSigner();

        const initIx = await getInitWalletInstructionAsync(
            { authority, wallet: wallet.address, allowed: true },
            { programAddress: ABL_TOKEN_PROGRAM_ADDRESS },
        );
        await send(initIx);

        const [abWalletPda] = await findAbWalletPda(
            { wallet: wallet.address },
            { programAddress: ABL_TOKEN_PROGRAM_ADDRESS },
        );
        const created = svm.getAccount(abWalletPda);
        if (!created?.exists) throw new Error('ab_wallet account was not created');

        const decoded = decodeABWallet({ ...created, address: abWalletPda });
        assert.equal(decoded.data.wallet, wallet.address);
        assert.isTrue(decoded.data.allowed);

        // `ab_wallet` is resolved from `wallet` by the generated client, using the seeds the
        // Rust account declares.
        const removeIx = await getRemoveWalletInstructionAsync(
            { authority, wallet: wallet.address },
            { programAddress: ABL_TOKEN_PROGRAM_ADDRESS },
        );
        await send(removeIx);

        const closed = svm.getAccount(abWalletPda);
        assert.isTrue(!closed?.exists || closed.data.length === 0, 'ab_wallet account should be closed');
    });

    it('rejects removing a wallet for a caller who is not the config authority', async () => {
        const wallet = await generateKeyPairSigner();
        const initIx = await getInitWalletInstructionAsync(
            { authority, wallet: wallet.address, allowed: false },
            { programAddress: ABL_TOKEN_PROGRAM_ADDRESS },
        );
        await send(initIx);

        const impostor = await generateKeyPairSigner();
        svm.airdrop(impostor.address, lamports(BigInt(10_000_000_000)));

        const removeIx = await getRemoveWalletInstructionAsync(
            { authority: impostor, wallet: wallet.address },
            { programAddress: ABL_TOKEN_PROGRAM_ADDRESS },
        );

        let threw = false;
        try {
            await send(removeIx, impostor);
        } catch {
            threw = true;
        }
        assert.isTrue(threw, 'expected the has_one authority check to reject a non-authority caller');

        const [abWalletPda] = await findAbWalletPda(
            { wallet: wallet.address },
            { programAddress: ABL_TOKEN_PROGRAM_ADDRESS },
        );
        const stillThere = svm.getAccount(abWalletPda);
        if (!stillThere?.exists) throw new Error('ab_wallet account should still exist');
    });
});
