import type { Metadata } from 'next';
import './globals.css';
import type React from 'react';
import { AppLayout } from '@/components/app-layout';
import { AppProviders } from '@/components/app-providers';

export const metadata: Metadata = {
    title: 'ABL Token',
    description: 'ABL Token',
};

const links: { label: string; path: string }[] = [
    // More links...
    { label: 'Home', path: '/' },
    { label: 'Account', path: '/account' },
    { label: 'Config', path: '/config' },
    { label: 'Create New Token', path: '/create-token' },
    { label: 'Manage Token', path: '/manage-token' },
];

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
    return (
        <html lang="en" suppressHydrationWarning>
            <body className={`antialiased`}>
                <AppProviders>
                    <AppLayout links={links}>{children}</AppLayout>
                </AppProviders>
            </body>
        </html>
    );
}
// Patch BigInt so we can log it using JSON.stringify without any errors
declare global {
    interface BigInt {
        toJSON(): string;
    }
}

BigInt.prototype.toJSON = function () {
    return this.toString();
};
