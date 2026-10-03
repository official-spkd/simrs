import { Alert } from '@simrs/ui';
import type { ReactNode } from 'react';
import { requireSuperadmin } from '@/lib/server/session';

/**
 * Area operator platform (ADR-0010, ADR-0013). Gerbang juga dipanggil di setiap halaman di dalamnya: layout
 * tidak menghentikan halaman anak dirender, jadi pemeriksaan di layout saja tidak cukup.
 */
export default async function SuperadminLayout({ children }: { children: ReactNode }) {
  await requireSuperadmin();
  return (
    <div className="flex flex-col gap-5">
      <Alert level="info" title="Area superadmin">
        Hanya untuk operator platform (peran superadmin_platform). Akun RS mana pun tidak bisa membuka halaman
        ini.
      </Alert>
      {children}
    </div>
  );
}
