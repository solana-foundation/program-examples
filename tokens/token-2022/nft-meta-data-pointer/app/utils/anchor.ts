import { createSolanaRpc, createSolanaRpcSubscriptions } from '@solana/kit';
import { EXTENSION_NFT_PROGRAM_ADDRESS } from '@/generated/programs';
import { WrappedConnection } from './wrappedConnection';

const RPC_URL = process.env.NEXT_PUBLIC_RPC ?? 'https://rpc.magicblock.app/devnet';
const WSS_URL = process.env.NEXT_PUBLIC_WSS_RPC ?? 'wss://rpc.magicblock.app/devnet';

export const rpc = createSolanaRpc(RPC_URL);
export const rpcSubscriptions = createSolanaRpcSubscriptions(WSS_URL);

export const dasConnection = new WrappedConnection();

export const METAPLEX_READAPI = 'https://devnet.helius-rpc.com/?api-key=78065db3-87fb-431c-8d43-fcd190212125';

// Here you can basically use what ever seed you want. For example one per level or city or whatever.
export const GAME_DATA_SEED = 'level_2';

export const PROGRAM_ADDRESS = EXTENSION_NFT_PROGRAM_ADDRESS;

// Constants for the game
export const TIME_TO_REFILL_ENERGY = 60n;
export const MAX_ENERGY = 100n;
export const ENERGY_PER_TICK = 1n;
export const TOTAL_WOOD_AVAILABLE = 100000n;
