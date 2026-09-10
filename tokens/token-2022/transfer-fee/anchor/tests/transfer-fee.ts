import type { Program } from '@anchor-lang/core';
import * as anchor from '@anchor-lang/core';
import { ASSOCIATED_PROGRAM_ID } from '@anchor-lang/core/dist/cjs/utils/token';
import {
    getAccount,
    getAssociatedTokenAddressSync,
    getMint,
    getOrCreateAssociatedTokenAccount,
    getTransferFeeAmount,
    getTransferFeeConfig,
    mintTo,
    TOKEN_2022_PROGRAM_ID,
} from '@solana/spl-token';
import { assert } from 'chai';
import type { TransferFee } from '../target/types/transfer_fee';

describe('transfer-fee', () => {
    const provider = anchor.AnchorProvider.env();
    const connection = provider.connection;
    const wallet = provider.wallet as anchor.Wallet;
    anchor.setProvider(provider);

    const program = anchor.workspace.TransferFee as Program<TransferFee>;

    const mintKeypair = new anchor.web3.Keypair();
    const recipient = new anchor.web3.Keypair();

    const senderTokenAccountAddress = getAssociatedTokenAddressSync(
        mintKeypair.publicKey,
        wallet.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID,
    );

    const recipientTokenAccountAddress = getAssociatedTokenAddressSync(
        mintKeypair.publicKey,
        recipient.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID,
    );

    const fetchFeeConfig = async () => {
        const mint = await getMint(connection, mintKeypair.publicKey, undefined, TOKEN_2022_PROGRAM_ID);
        const config = getTransferFeeConfig(mint);
        assert.isNotNull(config, 'mint has no TransferFeeConfig extension');
        return config!;
    };

    const fetchTokenAccount = async (address: anchor.web3.PublicKey) => {
        const account = await getAccount(connection, address, undefined, TOKEN_2022_PROGRAM_ID);
        const withheld = getTransferFeeAmount(account);
        assert.isNotNull(withheld, 'token account has no TransferFeeAmount extension');
        return { amount: account.amount, withheld: withheld!.withheldAmount };
    };

    it('Create Mint with Transfer Fee', async () => {
        const transferFeeBasisPoints = 100;
        const maximumFee = 1;

        const transactionSignature = await program.methods
            .initialize(transferFeeBasisPoints, new anchor.BN(maximumFee))
            .accountsPartial({ mintAccount: mintKeypair.publicKey })
            .signers([mintKeypair])
            .rpc({ skipPreflight: true });
        console.log('Your transaction signature', transactionSignature);

        const config = await fetchFeeConfig();
        assert.isTrue(config.transferFeeConfigAuthority.equals(wallet.publicKey));
        assert.isTrue(config.withdrawWithheldAuthority.equals(wallet.publicKey));
        assert.strictEqual(config.withheldAmount, 0n);
        assert.strictEqual(config.newerTransferFee.transferFeeBasisPoints, transferFeeBasisPoints);
        assert.strictEqual(config.newerTransferFee.maximumFee, BigInt(maximumFee));
        assert.strictEqual(config.olderTransferFee.transferFeeBasisPoints, transferFeeBasisPoints);
        assert.strictEqual(config.olderTransferFee.maximumFee, BigInt(maximumFee));
    });

    it('Mint Tokens', async () => {
        await getOrCreateAssociatedTokenAccount(
            connection,
            wallet.payer,
            mintKeypair.publicKey,
            wallet.publicKey,
            false,
            null,
            null,
            TOKEN_2022_PROGRAM_ID,
            ASSOCIATED_PROGRAM_ID,
        );

        await mintTo(
            connection,
            wallet.payer,
            mintKeypair.publicKey,
            senderTokenAccountAddress,
            wallet.payer,
            300,
            [],
            null,
            TOKEN_2022_PROGRAM_ID,
        );

        const sender = await fetchTokenAccount(senderTokenAccountAddress);
        assert.strictEqual(sender.amount, 300n);
        assert.strictEqual(sender.withheld, 0n);
    });

    it('Transfer', async () => {
        const transactionSignature = await program.methods
            .transfer(new anchor.BN(100))
            .accountsPartial({
                sender: wallet.publicKey,
                recipient: recipient.publicKey,
                mintAccount: mintKeypair.publicKey,
                senderTokenAccount: senderTokenAccountAddress,
                recipientTokenAccount: recipientTokenAccountAddress,
            })
            .rpc({ skipPreflight: true });
        console.log('Your transaction signature', transactionSignature);

        // 1% of 100 is 1, which is also the cap. The sender is debited the full
        // amount; the fee comes out of the recipient's credit and is withheld there.
        const sender = await fetchTokenAccount(senderTokenAccountAddress);
        const recipientAccount = await fetchTokenAccount(recipientTokenAccountAddress);
        assert.strictEqual(sender.amount, 200n);
        assert.strictEqual(recipientAccount.amount, 99n);
        assert.strictEqual(recipientAccount.withheld, 1n);
    });

    it('Transfer Again, fee limit by maximumFee', async () => {
        const transactionSignature = await program.methods
            .transfer(new anchor.BN(200))
            .accountsPartial({
                sender: wallet.publicKey,
                recipient: recipient.publicKey,
                mintAccount: mintKeypair.publicKey,
                senderTokenAccount: senderTokenAccountAddress,
                recipientTokenAccount: recipientTokenAccountAddress,
            })
            .rpc({ skipPreflight: true });
        console.log('Your transaction signature', transactionSignature);

        // 1% of 200 would be 2; maximumFee holds it to 1, so withheld grows by 1, not 2.
        const sender = await fetchTokenAccount(senderTokenAccountAddress);
        const recipientAccount = await fetchTokenAccount(recipientTokenAccountAddress);
        assert.strictEqual(sender.amount, 0n);
        assert.strictEqual(recipientAccount.amount, 298n);
        assert.strictEqual(recipientAccount.withheld, 2n);
    });

    it('Harvest Transfer Fees to Mint Account', async () => {
        const transactionSignature = await program.methods
            .harvest()
            .accountsPartial({ mintAccount: mintKeypair.publicKey })
            .remainingAccounts([
                {
                    pubkey: recipientTokenAccountAddress,
                    isSigner: false,
                    isWritable: true,
                },
            ])
            .rpc({ skipPreflight: true });
        console.log('Your transaction signature', transactionSignature);

        const recipientAccount = await fetchTokenAccount(recipientTokenAccountAddress);
        const config = await fetchFeeConfig();
        assert.strictEqual(recipientAccount.withheld, 0n);
        assert.strictEqual(recipientAccount.amount, 298n);
        assert.strictEqual(config.withheldAmount, 2n);
    });

    it('Withdraw Transfer Fees from Mint Account', async () => {
        const transactionSignature = await program.methods
            .withdraw()
            .accountsPartial({
                mintAccount: mintKeypair.publicKey,
                tokenAccount: senderTokenAccountAddress,
            })
            .rpc({ skipPreflight: true });
        console.log('Your transaction signature', transactionSignature);

        const sender = await fetchTokenAccount(senderTokenAccountAddress);
        const config = await fetchFeeConfig();
        assert.strictEqual(config.withheldAmount, 0n);
        assert.strictEqual(sender.amount, 2n);
    });

    it('Update Transfer Fee', async () => {
        const transferFeeBasisPoints = 0;
        const maximumFee = 0;

        const epochBefore = BigInt((await connection.getEpochInfo()).epoch);
        const transactionSignature = await program.methods
            .updateFee(transferFeeBasisPoints, new anchor.BN(maximumFee))
            .accountsPartial({ mintAccount: mintKeypair.publicKey })
            .rpc({ skipPreflight: true });
        console.log('Your transaction signature', transactionSignature);

        const epochAfter = BigInt((await connection.getEpochInfo()).epoch);

        // The new fee is scheduled two epochs out from the epoch the transaction
        // executed in; the old one stays in force until then. The epoch is read on
        // both sides of the transaction so a rollover between them cannot flake.
        const config = await fetchFeeConfig();
        assert.strictEqual(config.newerTransferFee.transferFeeBasisPoints, 0);
        assert.strictEqual(config.newerTransferFee.maximumFee, 0n);
        assert.oneOf(config.newerTransferFee.epoch, [epochBefore + 2n, epochAfter + 2n]);
        assert.strictEqual(config.olderTransferFee.transferFeeBasisPoints, 100);
        assert.strictEqual(config.olderTransferFee.maximumFee, 1n);
    });
});
