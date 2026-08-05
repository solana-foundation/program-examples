import { Message, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import { AccountRole, type Instruction, type TransactionModifyingSigner } from '@solana/kit';

// @magicblock-labs/gum-react-sdk (the session-key feature) is pinned to
// @solana/web3.js and predates @solana/kit - these two helpers are the only
// place in the app that cross that boundary.

export function kitInstructionToLegacy(instruction: Instruction): TransactionInstruction {
    return new TransactionInstruction({
        programId: new PublicKey(instruction.programAddress),
        keys: (instruction.accounts ?? []).map(account => ({
            pubkey: new PublicKey(account.address),
            isSigner: account.role === AccountRole.READONLY_SIGNER || account.role === AccountRole.WRITABLE_SIGNER,
            isWritable: account.role === AccountRole.WRITABLE || account.role === AccountRole.WRITABLE_SIGNER,
        })),
        data: Buffer.from(instruction.data ?? new Uint8Array()),
    });
}

// gum-sdk's useSessionKeyManager expects an AnchorWallet-shaped signTransaction
// that returns a legacy Transaction. The connected wallet is only ever a kit
// TransactionModifyingSigner (from @solana/connector), so this signs via kit's
// wire format (message bytes are identical between web3.js and kit - only the
// surrounding object shapes differ) and reassembles a legacy Transaction from
// the result.
export async function signLegacyTransactionWithKitSigner(
    signer: TransactionModifyingSigner,
    transaction: Transaction,
): Promise<Transaction> {
    const messageBytes = transaction.serializeMessage();
    const [signed] = await signer.modifyAndSignTransactions([
        {
            messageBytes,
            signatures: {},
            lifetimeConstraint: { blockhash: transaction.recentBlockhash, lastValidBlockHeight: 0n },
        } as unknown as Parameters<TransactionModifyingSigner['modifyAndSignTransactions']>[0][number],
    ]);

    const signedTransaction = Transaction.populate(Message.from(Buffer.from(signed.messageBytes)));
    for (const [address, signature] of Object.entries(signed.signatures)) {
        if (signature) {
            signedTransaction.addSignature(new PublicKey(address), Buffer.from(signature));
        }
    }
    return signedTransaction;
}
