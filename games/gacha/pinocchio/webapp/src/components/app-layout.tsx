import type { ReactNode } from 'react';

import { AppHeader } from '@/components/app-header';

export function AppLayout({ children }: { children: ReactNode }) {
    return (
        <div className="min-h-dvh">
            <AppHeader />
            <main className="mx-auto w-full max-w-6xl px-6 pt-24 pb-16">{children}</main>
        </div>
    );
}
