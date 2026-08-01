'use client';

import type { ReactNode } from 'react';

import { Toaster } from '@/components/ui/sonner';
import { ClusterProvider } from '@/lib/cluster-context';
import { AppClientProvider } from '@/lib/client-provider';

export function AppProviders({ children }: { children: ReactNode }) {
    return (
        <ClusterProvider>
            <AppClientProvider>{children}</AppClientProvider>
            <Toaster />
        </ClusterProvider>
    );
}
