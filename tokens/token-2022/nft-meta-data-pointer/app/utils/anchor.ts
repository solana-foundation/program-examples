import { createSolanaRpc, createSolanaRpcSubscriptions } from '@solana/kit';
import { EXTENSION_NFT_PROGRAM_ADDRESS } from '@/generated/programs';

// Every part of the app that talks to a cluster - the kit RPC, the wallet
// connector, and the session-key Connection - reads from this one endpoint, so
// that setting NEXT_PUBLIC_RPC moves all of them together.
export const RPC_URL = process.env.NEXT_PUBLIC_RPC ?? 'https://rpc.magicblock.app/devnet';
const WSS_URL = process.env.NEXT_PUBLIC_WSS_RPC ?? 'wss://rpc.magicblock.app/devnet';

export const rpc = createSolanaRpc(RPC_URL);
export const rpcSubscriptions = createSolanaRpcSubscriptions(WSS_URL);

// Here you can basically use what ever seed you want. For example one per level or city or whatever.
export const GAME_DATA_SEED = 'level_2';

export const PROGRAM_ADDRESS = EXTENSION_NFT_PROGRAM_ADDRESS;

// Constants for the game
export const TIME_TO_REFILL_ENERGY = 60n;
export const MAX_ENERGY = 100n;
export const ENERGY_PER_TICK = 1n;
export const TOTAL_WOOD_AVAILABLE = 100000n;
