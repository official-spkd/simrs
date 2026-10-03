import { Alert } from '@simrs/ui';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { superadminAccess } from '@/lib/access';

// Gerbang dievaluasi per permintaan (bukan saat build) agar keputusan akses mengikuti env runtime.
export const dynamic = 'force-dynamic';

export default function SuperadminLayout({ children }: { children: ReactNode }) {
  const access = superadminAccess();
  if (!access.allowed) notFound();
  return (
    <div className="flex flex-col gap-5">
      <Alert level="warning" title="Area superadmin">
        Fase 0 belum memiliki login, sehingga area ini hanya terbuka di lingkungan non-produksi (APP_ENV
        local/staging). Di produksi halaman ini tidak ada (404) sampai peran superadmin platform tersedia di
        fase 1.
      </Alert>
      {children}
    </div>
  );
}
