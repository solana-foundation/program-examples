export function parseTransactionError(err: unknown): string {
    if (err instanceof Error && err.message.includes('User rejected')) {
        return 'Transaction was rejected by the wallet.';
    }

    const message = deepestMessage(err);
    return message.length > 240 ? `${message.slice(0, 240)}…` : message;
}

function deepestMessage(err: unknown): string {
    let deepest = err instanceof Error ? err.message : String(err);
    let current: unknown = err;

    while (current instanceof Error && current.cause) {
        current = current.cause;
        if (current instanceof Error) {
            deepest = current.message;
        }
    }

    return deepest;
}
