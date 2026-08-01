import { Toaster as Sonner, type ToasterProps } from 'sonner';

const Toaster = ({ ...props }: ToasterProps) => {
    return (
        <Sonner
            theme="light"
            position="top-center"
            richColors
            closeButton
            className="toaster group"
            style={
                {
                    '--normal-bg': 'var(--popover)',
                    '--normal-text': 'var(--popover-foreground)',
                    '--normal-border': 'var(--border)',
                } as React.CSSProperties
            }
            {...props}
        />
    );
};

export { Toaster };
