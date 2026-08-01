import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { AppLayout } from '@/components/app-layout';
import { AppProviders } from '@/components/providers';

import '../index.css';

export const metadata: Metadata = {
    description: 'A provably fair Solana gacha powered by cc-vrf.',
    title: 'SIMD All-Stars',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
    return (
        <html lang="en">
            <body>
                <AppProviders>
                    <AppLayout>{children}</AppLayout>
                </AppProviders>
            </body>
        </html>
    );
}
