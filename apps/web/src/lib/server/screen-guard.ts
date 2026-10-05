import 'server-only';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { type ScreenDef, screenById, screenOpen } from '../screens';
import type { SessionView } from '../session-view';
import { type DemoScreenAccess, requireDemoScreen } from './demo-guard';
import { requireSession } from './session';
import { webEnv } from './web-env';

/**
 * Gerbang layar hibrida demo/api (rencana fase 2 potongan 0c). Satu pintu untuk halaman yang punya jalur data dummy
 * (mode presentasi, ADR-0023) dan jalur API:
 * - mode presentasi → `requireDemoScreen` (sesi + posisi pemakai layar, data dummy);
 * - mode api → sesi lengkap + izin sungguhan dari registri (`ScreenDef.permission`), diperiksa ulang oleh API.
 * Layar tanpa `permission` tidak punya jalur api: di mode api 404, sama seperti layar demo biasa.
 */

export type ScreenAccess =
  | ({ mode: 'demo' } & DemoScreenAccess)
  | {
      mode: 'api';
      session: SessionView;
      screen: ScreenDef;
      /** false = peran aktif tidak memegang `screen.permission`; halaman menampilkan "Akses ditolak". */
      allowed: boolean;
    };

export async function requireScreen(id: string): Promise<ScreenAccess> {
  await connection();
  if (webEnv().dataSource === 'demo') {
    if (screenById(id)?.apiOnly) notFound();
    return { mode: 'demo', ...(await requireDemoScreen(id)) };
  }
  const screen = screenById(id);
  if (!screen?.permission || screen.status === 'belum') notFound();
  const session = await requireSession();
  return {
    mode: 'api',
    session,
    screen,
    allowed: screenOpen(screen, {
      dataSource: 'api',
      role: session.role?.code ?? null,
      permissions: session.permissions,
    }),
  };
}
