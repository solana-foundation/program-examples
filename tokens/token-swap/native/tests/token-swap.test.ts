import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import { Program, AnchorProvider, web3 } from '@project-serum/anchor';

describe('token-swap-native', () => {
  const provider = AnchorProvider.env();
  AnchorProvider.env().wallet;
  const connection = provider.connection;
  const programId = new PublicKey('<SEU_PROGRAM_ID_AQUI>');

  it('Is initialized!', async () => {
    const transaction = new Transaction().add(
      new TransactionInstruction({
        keys: [],
        programId,
        data: Buffer.from([]),
      })
    );

    await provider.sendAndConfirm(transaction);
  });
});
