import 'server-only';
import { formatJam } from '@simrs/shared';
import { redirect } from 'next/navigation';
import { screenById, screenOpen } from './screens';
import { assertDemo } from './server/demo-guard';
import { getSession } from './server/session';
import { nextLoginStep, type SessionView } from './session-view';
import type { SupportEvent } from './penunjang-demo';
import { commitEvent } from './server/demo/state';

/**
 * Pola Server Action layar penunjang di mode presentasi (ADR-0023, pembangun-layar §7): gerbang demo, sesi lengkap,
 * posisi yang memakai layar, input divalidasi zod di action masing-masing, dan commit berversi ke toko demo.
 */

export interface PenunjangActionResult {
  ok: boolean;
  /** Umpan balik ("… tersimpan · 10.47") atau pesan galat. */
  message: string;
  /** Jam aksi (WIB), mis. "10.47". */
  at?: string;
  /** Isian yang galat (untuk menandai field). */
  field?: string;
  stale?: boolean;
}

/** Sesi lengkap yang boleh memakai layar `screenId`; null bila posisinya bukan pemakai layar ini. */
export async function penunjangSession(screenId: string): Promise<SessionView | null> {
  assertDemo();
  const s = await getSession();
  if (!s || nextLoginStep(s, false) !== 'selesai') redirect('/masuk');
  const screen = screenById(screenId);
  if (
    !screen ||
    !screenOpen(screen, { dataSource: 'demo', role: s.role?.code ?? null, allAccess: !!s.demoAllAccess })
  )
    return null;
  return s;
}

export const DENIED: PenunjangActionResult = {
  ok: false,
  message: 'Posisi aktif Anda tidak memakai layar ini. Ganti posisi untuk melanjutkan.',
};

export function invalid(message: string, field?: string): PenunjangActionResult {
  return { ok: false, message, field };
}

/** Commit diperiksa ulang oleh reducer di bawah kunci toko; revisi basi ditolak. */
export async function saveSupport(
  session: SessionView,
  event: SupportEvent,
  rev: number,
): Promise<PenunjangActionResult> {
  assertDemo();
  if (!Number.isSafeInteger(rev) || rev < 0) return invalid('Revisi tampilan tidak sah. Muat ulang halaman.');
  const r = await commitEvent('penunjang', event, { rev, session });
  if (!r.ok) return { ok: false, message: r.error, stale: r.stale };
  const at = formatJam(new Date());
  return { ok: true, at, message: `Tindakan tersimpan atas nama ${session.user.displayName} · ${at}` };
}
