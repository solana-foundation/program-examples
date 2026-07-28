import { PublicKey } from '@solana/web3.js';

export * from './accounts';
export * from './instructions';
export * from './types';

/**
 * Program address
 *
 * @category constants
 * @category generated
 */
export const PROGRAM_ADDRESS = '8avNGHVXDwsELJaWMSoUZ44CirQd4zyU9Ez4ZmP4jNjZ';

/**
 * Program public key
 *
 * @category constants
 * @category generated
 */
export const PROGRAM_ID = new PublicKey(PROGRAM_ADDRESS);
