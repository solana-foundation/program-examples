import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

export function AppModal({
    children,
    title,
    submit,
    submitDisabled,
    submitLabel,
}: {
    children: ReactNode;
    title: string;
    submit?: () => void;
    submitDisabled?: boolean;
    submitLabel?: string;
}) {
    return (
        <Dialog>
            <DialogTrigger asChild>
                <Button variant="outline">{title}</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[525px]">
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                </DialogHeader>
                <div className="grid gap-4 py-4">{children}</div>
                <DialogFooter>
                    {submit ? (
                        <Button type="submit" onClick={submit} disabled={submitDisabled}>
                            {submitLabel || 'Save'}
                        </Button>
                    ) : null}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
