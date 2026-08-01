import * as React from 'react';

import { cn } from '@/lib/utils';

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
    return (
        <input
            type={type}
            data-slot="input"
            className={cn(
                'flex h-9 w-full min-w-0 rounded-lg border border-input bg-background px-3 py-1 text-sm shadow-xs transition-colors outline-none',
                'placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
                'disabled:pointer-events-none disabled:opacity-50',
                className,
            )}
            {...props}
        />
    );
}

export { Input };
