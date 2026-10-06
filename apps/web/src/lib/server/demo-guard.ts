import 'server-only';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { type ScreenDef, screenById, screenOpen } from '../screens';
import type { SessionView } from '../session-view';
import { requireSession } from './session';
import { webEnv } from './web-env';

export { assertDemo } from './demo-mode';

/**
 * Gerbang mode presentasi (ADR-0023). Halaman ber-data dummy memanggil `requireDemoScreen()`; Server Action
 * ber-data dummy memanggil `assertDemo()` — action ikut ter-build sebagai endpoint POST, jadi gerbang halaman saja
 * tidak cukup.
 */

/** Selalu render dinamis (env dibaca per permintaan, tidak pernah di-prerender saat build), lalu 404 di luar demo. */
export async function requireDemoPage(): Promise<void> {
  await connection();
  if (webEnv().dataSource !== 'demo') notFound();
}

export interface DemoScreenAccess {
  session: SessionView;
  screen: ScreenDef;
  /**
   * false = posisi aktif bukan pemakai layar ini; halaman menampilkan ajakan "Ganti posisi". Superadmin demo selalu
   * true (ADR-0023 keputusan 10).
   */
  allowed: boolean;
}

/** Sesi + layar terdaftar + hak posisi aktif. Layar tak terdaftar atau `belum` → 404. */
export async function requireDemoScreen(id: string): Promise<DemoScreenAccess> {
  await requireDemoPage();
  const session = await requireSession();
  const screen = screenById(id);
  if (!screen || screen.status === 'belum') notFound();
  return {
    session,
    screen,
    allowed: screenOpen(screen, {
      dataSource: 'demo',
      role: session.role?.code ?? null,
      allAccess: Boolean(session.demoAllAccess),
    }),
  };
}
