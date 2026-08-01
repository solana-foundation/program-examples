import { VerifyPanel } from '@/components/gacha/verify-panel';

export default async function VerifyPage({ searchParams }: Readonly<{ searchParams: Promise<{ pull?: string }> }>) {
    const { pull = '' } = await searchParams;
    return (
        <div className="mx-auto w-full max-w-2xl">
            <VerifyPanel initialPull={pull} />
        </div>
    );
}
