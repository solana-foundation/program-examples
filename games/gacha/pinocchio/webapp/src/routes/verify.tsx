import { useSearchParams } from 'react-router';

import { VerifyPanel } from '@/components/gacha/verify-panel';

export function Verify() {
    const [params] = useSearchParams();
    return (
        <div className="mx-auto w-full max-w-2xl">
            <VerifyPanel initialPull={params.get('pull') ?? ''} />
        </div>
    );
}
