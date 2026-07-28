'use client';
import { Menu, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { WalletButton } from '@/components/solana/solana-provider';
import { ThemeSelect } from '@/components/theme-select';
import { Button } from '@/components/ui/button';
import { ClusterUiSelect } from './cluster/cluster-ui';

export function AppHeader({ links = [] }: { links: { label: string; path: string }[] }) {
    const pathname = usePathname();
    const [showMenu, setShowMenu] = useState(false);

    function isActive(path: string) {
        return path === '/' ? pathname === '/' : pathname.startsWith(path);
    }

    return (
        <header className="relative z-50 px-4 py-2 bg-neutral-100 dark:bg-neutral-900 dark:text-neutral-400">
            <div className="mx-auto flex justify-between items-center">
                <div className="flex items-baseline gap-4">
                    <Link className="text-xl hover:text-neutral-500 dark:hover:text-white" href="/">
                        <span>ABL Token</span>
                    </Link>
                    <div className="hidden md:flex items-center">
                        <ul className="flex gap-4 flex-nowrap items-center">
                            {links.map(({ label, path }) => (
                                <li key={path}>
                                    <Link
                                        className={`hover:text-neutral-500 dark:hover:text-white ${isActive(path) ? 'text-neutral-500 dark:text-white' : ''}`}
                                        href={path}
                                    >
                                        {label}
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>

                <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setShowMenu(!showMenu)}>
                    {showMenu ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
                </Button>

                <div className="hidden md:flex items-center gap-4">
                    <WalletButton />
                    <ClusterUiSelect />
                    <ThemeSelect />
                </div>

                {showMenu && (
                    <div className="md:hidden fixed inset-x-0 top-[52px] bottom-0 bg-neutral-100/95 dark:bg-neutral-900/95 backdrop-blur-sm">
                        <div className="flex flex-col p-4 gap-4 border-t dark:border-neutral-800">
                            <ul className="flex flex-col gap-4">
                                {links.map(({ label, path }) => (
                                    <li key={path}>
                                        <Link
                                            className={`hover:text-neutral-500 dark:hover:text-white block text-lg py-2  ${isActive(path) ? 'text-neutral-500 dark:text-white' : ''} `}
                                            href={path}
                                            onClick={() => setShowMenu(false)}
                                        >
                                            {label}
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                            <div className="flex flex-col gap-4">
                                <WalletButton />
                                <ClusterUiSelect />
                                <ThemeSelect />
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </header>
    );
}
