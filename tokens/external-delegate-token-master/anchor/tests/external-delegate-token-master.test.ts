import { createMint, getOrCreateAssociatedTokenAccount, mintTo } from '@solana/spl-token';
import { Connection, Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import { expect } from 'chai';
import { start } from 'solana-bankrun';

jest.setTimeout(30000); // Set timeout to 30 seconds

const ACCOUNT_SIZE = 8 + 32 + 20; // Define your account size here

async function retryWithBackoff(fn: () => Promise<any>, retries = 5, delay = 500): Promise<any> {
    try {
        return await fn();
    } catch (err) {
        if (retries === 0) throw err;
        await new Promise(resolve => setTimeout(resolve, delay));
        return retryWithBackoff(fn, retries - 1, delay * 2);
    }
}

describe('External Delegate Token Master Tests', () => {
    let context: any;
    let _program: any;
    let authority: Keypair;
    let userAccount: Keypair;
    let mint: PublicKey;
    let userTokenAccount: PublicKey;
    let _recipientTokenAccount: PublicKey;
    let _userPda: PublicKey;
    let _bumpSeed: number;

    beforeEach(async () => {
        authority = Keypair.generate();
        userAccount = Keypair.generate();

        const programs = [
            {
                name: 'external_delegate_token_master',
                programId: new PublicKey('FYPkt5VWMvtyWZDMGCwoKFkE3wXTzphicTpnNGuHWVbD'),
                program: 'target/deploy/external_delegate_token_master.so',
            },
        ];

        context = await retryWithBackoff(async () => await start(programs, []));

        const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
        context.connection = connection;

        // Airdrop SOL to authority with retry logic
        await retryWithBackoff(async () => {
            await connection.requestAirdrop(authority.publicKey, 1000000000);
        });

        // Create mint with retry logic
        mint = await retryWithBackoff(
            async () => await createMint(connection, authority, authority.publicKey, null, 6),
        );

        const userTokenAccountInfo = await retryWithBackoff(
            async () => await getOrCreateAssociatedTokenAccount(connection, authority, mint, authority.publicKey),
        );
        userTokenAccount = userTokenAccountInfo.address;

        const recipientTokenAccountInfo = await retryWithBackoff(
            async () =>
                await getOrCreateAssociatedTokenAccount(connection, authority, mint, Keypair.generate().publicKey),
        );
        _recipientTokenAccount = recipientTokenAccountInfo.address;

        // Mint tokens to the user's account
        await retryWithBackoff(
            async () => await mintTo(connection, authority, mint, userTokenAccount, authority, 1000000000),
        );

        // Find program-derived address (PDA)
        [_userPda, _bumpSeed] = await retryWithBackoff(
            async () =>
                await PublicKey.findProgramAddress([userAccount.publicKey.toBuffer()], context.program.programId),
        );
    });

    it('should initialize user account', async () => {
        const space = ACCOUNT_SIZE;
        const rentExempt = await retryWithBackoff(async () => {
            return await context.connection.getMinimumBalanceForRentExemption(space);
        });

        await context.program.methods
            .initialize()
            .accounts({
                userAccount: userAccount.publicKey,
                authority: authority.publicKey,
                systemProgram: SystemProgram.programId,
            })
            .preInstructions([
                SystemProgram.createAccount({
                    fromPubkey: authority.publicKey,
                    newAccountPubkey: userAccount.publicKey,
                    lamports: rentExempt,
                    space: space,
                    programId: context.program.programId,
                }),
            ])
            .signers([authority, userAccount])
            .rpc();

        const account = await context.program.account.userAccount.fetch(userAccount.publicKey);
        expect(account.authority.toString()).to.equal(authority.publicKey.toString());
        expect(account.ethereumAddress).to.deep.equal(new Array(20).fill(0));
    });

    it('should set ethereum address', async () => {
        const ethereumAddress = Buffer.from('1C8cd0c38F8DE35d6056c7C7aBFa7e65D260E816', 'hex');

        await context.program.methods
            .setEthereumAddress(ethereumAddress)
            .accounts({
                userAccount: userAccount.publicKey,
                authority: authority.publicKey,
            })
            .signers([authority])
            .rpc();

        const account = await context.program.account.userAccount.fetch(userAccount.publicKey);
        expect(account.ethereumAddress).to.deep.equal(Array.from(ethereumAddress));
    });

    it('should perform authority transfer', async () => {
        const newAuthority = Keypair.generate();

        await context.program.methods
            .transferAuthority(newAuthority.publicKey)
            .accounts({
                userAccount: userAccount.publicKey,
                authority: authority.publicKey,
            })
            .signers([authority])
            .rpc();

        const account = await context.program.account.userAccount.fetch(userAccount.publicKey);
        expect(account.authority.toString()).to.equal(newAuthority.publicKey.toString());
    });

    afterEach(async () => {
        if (context && typeof context.terminate === 'function') {
            await context.terminate();
        }
    });
});
