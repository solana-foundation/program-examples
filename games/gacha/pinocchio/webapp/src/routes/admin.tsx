import { AdminPanel } from '@/components/gacha/admin-panel';

export function Admin() {
    return (
        <div className="mx-auto w-full max-w-2xl space-y-6">
            <div>
                <h1 className="text-2xl font-bold tracking-tight">Admin</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    Create and manage a gacha pool. The connected wallet is the pool admin.
                </p>
            </div>
            <AdminPanel />
        </div>
    );
}
