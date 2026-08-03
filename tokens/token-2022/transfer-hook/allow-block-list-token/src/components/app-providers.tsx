'use client';

import type React from 'react';
import { ClusterProvider } from '@/components/cluster/cluster-data-access';
import { SolanaProvider } from '@/components/solana/solana-provider';
import { ThemeProvider } from '@/components/theme-provider';
import { ReactQueryProvider } from './react-query-provider';

export function AppProviders({ children }: Readonly<{ children: React.ReactNode }>) {
    return (
        <ReactQueryProvider>
            <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
                <ClusterProvider>
                    <SolanaProvider>{children}</SolanaProvider>
                </ClusterProvider>
            </ThemeProvider>
        </ReactQueryProvider>
    );
}
