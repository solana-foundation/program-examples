import * as anchor from '@anchor-lang/core';
import type { CnftVault } from '../../target/types/cnft_vault';
import IDL from '../../target/types/cnft_vault';
import { loadWalletKey } from '../utils';

export const connection = new anchor.web3.Connection('https://api.devnet.solana.com');
export const keypair = loadWalletKey('~/.config/solana/id.json');
export const wallet = new anchor.Wallet(keypair);
export const provider = new anchor.AnchorProvider(connection, wallet, {});
export const programID = new anchor.web3.PublicKey('CNftyK7T8udPwYRzZUMWzbh79rKrz9a5GwV2wv7iEHpk');
export const program = new anchor.Program<CnftVault>(IDL, programID, provider);
