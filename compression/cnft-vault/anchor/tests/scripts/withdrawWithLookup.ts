import * as anchor from '@anchor-lang/core';
import { PROGRAM_ID as BUBBLEGUM_PROGRAM_ID } from '@metaplex-foundation/mpl-bubblegum';
import { SPL_ACCOUNT_COMPRESSION_PROGRAM_ID, SPL_NOOP_PROGRAM_ID } from '@solana/spl-account-compression';
import {
    type AccountMeta,
    AddressLookupTableProgram,
    type PublicKey,
    SystemProgram,
    sendAndConfirmTransaction,
    Transaction,
    TransactionMessage,
    VersionedTransaction,
} from '@solana/web3.js';
import { getAsset, getAssetProof } from '../readAPI';
import { decode, mapProof } from '../utils';

import { connection, keypair, program, programID } from './constants';

async function main() {
    // TODO change all of these to your values
    const assetId1 = 'DGWU3mHenDerCvjkeDsKYEbsvXbWvqdo1bVoXy3dkeTd';
    const assetId2 = '14JojSTdBZvP7f77rCxB3oQK78skTVD6DiXrXUL4objg'; //"D2CoMLCRfsfv1EAiNbaBHfoU1Sqf1964KXLGxEfyUwWo";

    const tree1 = new anchor.web3.PublicKey('trezdkTFPKyj4gE9LAJYPpxn8AYVCvM7Mc4JkTb9X5B');
    const tree2 = new anchor.web3.PublicKey('trezdkTFPKyj4gE9LAJYPpxn8AYVCvM7Mc4JkTb9X5B');

    const receiver1 = new anchor.web3.PublicKey('Andys9wuoMdUeRiZLgRS5aJwYNFv4Ut6qQi8PNDTAPEM');
    const receiver2 = new anchor.web3.PublicKey('Andys9wuoMdUeRiZLgRS5aJwYNFv4Ut6qQi8PNDTAPEM');
    // ---

    const lookupTable = await createLookupTable();

    const [vaultPDA, _bump] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from('cNFT-vault', 'utf8')],
        programID,
    );

    const [treeAuthority1, _bump2] = anchor.web3.PublicKey.findProgramAddressSync(
        [tree1.toBuffer()],
        BUBBLEGUM_PROGRAM_ID,
    );
    const [treeAuthority2, _bump3] = anchor.web3.PublicKey.findProgramAddressSync(
        [tree2.toBuffer()],
        BUBBLEGUM_PROGRAM_ID,
    );

    const asset1 = await getAsset(assetId1);
    const asset2 = await getAsset(assetId2);

    const proof1 = await getAssetProof(assetId1);
    const proofPathAsAccounts1 = mapProof(proof1);
    const proof2 = await getAssetProof(assetId2);
    const proofPathAsAccounts2 = mapProof(proof2);

    const ixData1 = getInstructionData(asset1, proof1);
    const ixData2 = getInstructionData(asset2, proof2);

    const remainingAccounts: AccountMeta[] = [...proofPathAsAccounts1, ...proofPathAsAccounts2];

    const ix = await program.methods
        .withdrawTwoCnfts(...ixData1, ...ixData2)
        .accounts({
            leafOwner: vaultPDA,
            merkleTree1: tree1,
            newLeafOwner1: receiver1,
            treeAuthority1: treeAuthority1,
            merkleTree2: tree2,
            newLeafOwner2: receiver2,
            treeAuthority2: treeAuthority2,
            bubblegumProgram: BUBBLEGUM_PROGRAM_ID,
            compressionProgram: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
            logWrapper: SPL_NOOP_PROGRAM_ID,
            systemProgram: anchor.web3.SystemProgram.programId,
        })
        .remainingAccounts(remainingAccounts)
        .instruction();

    await extendLookupTable(
        lookupTable,
        proofPathAsAccounts1.map(acc => acc.pubkey),
    );
    await extendLookupTable(
        lookupTable,
        proofPathAsAccounts2.map(acc => acc.pubkey),
    );

    const lookupTableAccount = await connection.getAddressLookupTable(lookupTable).then(res => res.value);

    if (!lookupTableAccount) {
        console.log('could not fetch ATL!');
        return;
    }

    await new Promise(_ => setTimeout(_, 30000));

    const messageV0 = new TransactionMessage({
        payerKey: keypair.publicKey,
        recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
        instructions: [ix],
    }).compileToV0Message([lookupTableAccount]);

    const transactionV0 = new VersionedTransaction(messageV0);
    transactionV0.sign([keypair]);

    const txid = await connection.sendTransaction(transactionV0);
    console.log(txid);
}

function getInstructionData(asset: any, proof: any): [number[], number[], number[], anchor.BN, number, number] {
    const root = decode(proof.root);
    const dataHash = decode(asset.compression.data_hash);
    const creatorHash = decode(asset.compression.creator_hash);
    const nonce = new anchor.BN(asset.compression.leaf_id);
    const index = asset.compression.leaf_id;
    const proofLength = proof.proof.length;
    return [root, dataHash, creatorHash, nonce, index, proofLength];
}

main();

async function extendLookupTable(lookupTableAddress: PublicKey, proofHashes: PublicKey[]) {
    const extendInstruction = AddressLookupTableProgram.extendLookupTable({
        payer: keypair.publicKey,
        authority: keypair.publicKey,
        lookupTable: lookupTableAddress,
        addresses: [...proofHashes],
    });

    const tx = new Transaction();
    tx.add(extendInstruction);

    const sx = await sendAndConfirmTransaction(connection, tx, [keypair], {
        commitment: 'finalized',
    });
    console.log(sx);
    console.log('ALT extended!');
}

async function createLookupTable(): Promise<PublicKey> {
    const slot = await connection.getSlot();

    const [lookupTableInst, lookupTableAddress] = AddressLookupTableProgram.createLookupTable({
        authority: keypair.publicKey,
        payer: keypair.publicKey,
        recentSlot: slot,
    });
    console.log(lookupTableAddress.toBase58());

    const extendInstruction = AddressLookupTableProgram.extendLookupTable({
        payer: keypair.publicKey,
        authority: keypair.publicKey,
        lookupTable: lookupTableAddress,
        addresses: [
            programID,
            SystemProgram.programId,
            BUBBLEGUM_PROGRAM_ID,
            SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
            SPL_NOOP_PROGRAM_ID,
            // you could add more addresses here, like merkle trees, leaf owners etc.
        ],
    });

    const tx = new Transaction();
    tx.add(lookupTableInst).add(extendInstruction);

    const sx = await sendAndConfirmTransaction(connection, tx, [keypair], {
        commitment: 'finalized',
    });
    console.log(sx);
    console.log('ALT created');

    return lookupTableAddress;
}
