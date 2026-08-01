/** Stages in the unified pull pipeline. */
export type PullStage = 'claim' | 'request' | 'settle' | 'submit' | 'validation';

/** An expected pull-pipeline failure suitable for an API response. */
export class PullProcessError extends Error {
    override readonly name = 'PullProcessError';

    constructor(
        readonly stage: PullStage,
        readonly code: string,
        message: string,
        readonly retryable: boolean,
        readonly signatures: Readonly<{
            buySignature?: string;
            claimSignature?: string;
            settleSignature?: string;
        }> = {},
    ) {
        super(message);
    }
}
