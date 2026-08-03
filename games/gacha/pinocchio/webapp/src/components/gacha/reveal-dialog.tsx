import type { ReactNode } from 'react';

import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';

/**
 * Spotlight overlay that hosts the pack-opening stage. The page underneath stays
 * mounted and untouched, so revealing a card never shifts the layout. Radix
 * supplies the focus trap, scroll-lock, escape-to-close, and focus restoration.
 */
export function RevealDialog({
    open,
    onOpenChange,
    children,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    children: ReactNode;
}) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto border-0 bg-transparent p-0 shadow-none">
                <DialogTitle className="sr-only">Pack reveal</DialogTitle>
                <DialogDescription className="sr-only">
                    Watch your gacha pull settle on-chain and reveal its collectible card.
                </DialogDescription>
                {children}
            </DialogContent>
        </Dialog>
    );
}
