import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { SimdPreview } from '@/components/gacha/simd-preview-app';

import './index.css';

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <SimdPreview />
    </StrictMode>,
);
