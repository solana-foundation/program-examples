import { Navigate, Route, Routes } from 'react-router';

import { AppLayout } from '@/components/app-layout';
import { AppProviders } from '@/components/providers';
import { Admin } from '@/routes/admin';
import { Home } from '@/routes/home';
import { Verify } from '@/routes/verify';

export default function App() {
    return (
        <AppProviders>
            <AppLayout>
                <Routes>
                    <Route path="/" element={<Home />} />
                    <Route path="/verify" element={<Verify />} />
                    <Route path="/admin" element={<Admin />} />
                    <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
            </AppLayout>
        </AppProviders>
    );
}
