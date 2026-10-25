import {
    type Address,
    generateKeyPairSigner,
    getProgramDerivedAddress,
    type KeyPairSigner,
    getAddressEncoder,
    getBytesEncoder,
} from '@solana/kit';
import { findAssociatedTokenPda } from '@solana-program/token';

export const AUTHORITY_SEED = new TextEncoder().encode('authority');
export const LIQUIDITY_SEED = new TextEncoder().encode('liquidity');

export async function deriveAmmPda(id: Address, programId: Address): Promise<Address> {
    const addressEncoder = getAddressEncoder();
    const [pda] = await getProgramDerivedAddress({
        programAddress: programId,
        seeds: [addressEncoder.encode(id)],
    });
    return pda;
}

export async function derivePoolPda(amm: Address, mintA: Address, mintB: Address, programId: Address): Promise<Address> {
    const addressEncoder = getAddressEncoder();
    const [pda] = await getProgramDerivedAddress({
        programAddress: programId,
        seeds: [
            addressEncoder.encode(amm),
            addressEncoder.encode(mintA),
            addressEncoder.encode(mintB),
        ],
    });
    return pda;
}

export async function derivePoolAuthorityPda(amm: Address, mintA: Address, mintB: Address, programId: Address): Promise<Address> {
    const addressEncoder = getAddressEncoder();
    const [pda] = await getProgramDerivedAddress({
        programAddress: programId,
        seeds: [
            addressEncoder.encode(amm),
            addressEncoder.encode(mintA),
            addressEncoder.encode(mintB),
            AUTHORITY_SEED,
        ],
    });
    return pda;
}

export async function deriveMintLiquidityPda(amm: Address, mintA: Address, mintB: Address, programId: Address): Promise<Address> {
    const addressEncoder = getAddressEncoder();
    const [pda] = await getProgramDerivedAddress({
        programAddress: programId,
        seeds: [
            addressEncoder.encode(amm),
            addressEncoder.encode(mintA),
            addressEncoder.encode(mintB),
            LIQUIDITY_SEED,
        ],
    });
    return pda;
}
