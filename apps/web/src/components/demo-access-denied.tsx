import { SYSTEM_ROLES, type SystemRoleCode } from '@simrs/shared';
import { Alert } from '@simrs/ui';
import Link from 'next/link';
import type { ScreenDef } from '@/lib/screens';

/**
 * Mode presentasi: posisi aktif bukan pemakai layar ini. Menjelaskan posisi yang tepat dan menawarkan "Ganti
 * posisi" (akun demo memegang semua posisi), alih-alih 404 yang membingungkan saat presentasi.
 */
export function DemoAccessDenied({ screen }: { screen: ScreenDef }) {
  const roles =
    screen.demoRoles === 'semua'
      ? 'semua posisi'
      : screen.demoRoles.map((r) => SYSTEM_ROLES[r as SystemRoleCode]).join(', ');
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <h1 className="m-0 text-h1 font-semibold">{screen.label}</h1>
      <Alert level="warning" title="Layar ini untuk posisi lain">
        Layar {screen.label} dipakai oleh posisi: {roles}. <Link href="/akun/posisi">Ganti posisi</Link> untuk
        membukanya.
      </Alert>
    </div>
  );
}
