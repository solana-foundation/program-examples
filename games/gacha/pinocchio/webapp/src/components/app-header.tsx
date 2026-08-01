'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { ClusterSelect } from '@/components/cluster-select';
import { WalletButton } from '@/components/wallet-button';
import { cn } from '@/lib/utils';

const NAV = [
    { label: 'Play', path: '/' },
    { label: 'Verify', path: '/verify' },
    { label: 'Admin', path: '/admin' },
];

export function AppHeader() {
    const pathname = usePathname();

    return (
        <header className="fixed inset-x-0 top-0 z-40 border-b border-border-low/70 bg-background/70 backdrop-blur-sm">
            <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
                <Link href="/" className="flex items-center gap-2">
                    <img src="/gacha.svg" alt="" className="h-6 w-6 shrink-0" />
                    <span className="text-lg font-semibold tracking-tight">
                        <span className="sm:hidden">SIMD</span>
                        <span className="hidden sm:inline">SIMD All-Stars</span>
                    </span>
                </Link>

                <nav className="hidden items-center gap-1 md:flex">
                    {NAV.map(item => {
                        const active = item.path === '/' ? pathname === '/' : pathname.startsWith(item.path);
                        return (
                            <Link
                                key={item.path}
                                href={item.path}
                                className={cn(
                                    'rounded-full px-3 py-2 text-sm font-medium transition-colors',
                                    active
                                        ? 'bg-sand-200 text-foreground'
                                        : 'text-sand-1100 hover:bg-sand-100 hover:text-foreground',
                                )}
                            >
                                {item.label}
                            </Link>
                        );
                    })}
                </nav>

                <div className="flex items-center gap-2">
                    <ClusterSelect />
                    <WalletButton />
                </div>
            </div>
        </header>
    );
}
