import { AlertCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

export function AppAlert({ action, children }: { action: ReactNode; children: ReactNode }) {
    return (
        <Alert variant="warning">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>{children}</AlertTitle>
            <AlertDescription className="flex justify-end">{action}</AlertDescription>
        </Alert>
    );
}
