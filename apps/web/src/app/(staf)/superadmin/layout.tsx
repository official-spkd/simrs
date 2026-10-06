import { Alert } from '@simrs/ui';
import type { ReactNode } from 'react';
import { requireGuideReader } from '@/lib/server/session';
import { isSuperadmin } from '@/lib/session-view';

/**
 * Area operator platform (ADR-0010, ADR-0013). Gerbang juga dipanggil di setiap halaman di dalamnya: layout
 * tidak menghentikan halaman anak dirender, jadi pemeriksaan di layout saja tidak cukup. Layout memakai gerbang
 * paling longgar di area ini (panduan: juga Superadmin demo di mode presentasi, ADR-0023 keputusan 10); halaman
 * superadmin selain panduan WAJIB memanggil `requireSuperadmin()` sendiri.
 */
export default async function SuperadminLayout({ children }: { children: ReactNode }) {
  const s = await requireGuideReader();
  return (
    <div className="flex flex-col gap-5">
      {isSuperadmin(s) ? (
        <Alert level="info" title="Area superadmin">
          Hanya untuk operator platform (peran superadmin_platform). Akun RS mana pun tidak bisa membuka
          halaman ini.
        </Alert>
      ) : (
        <Alert level="info" title="Panduan · mode presentasi">
          Dibuka sebagai Superadmin demo (hanya baca). Di luar mode presentasi halaman ini hanya untuk
          operator platform.
        </Alert>
      )}
      {children}
    </div>
  );
}
