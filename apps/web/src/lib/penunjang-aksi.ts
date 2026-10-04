import 'server-only';
import { formatJam } from '@simrs/shared';
import { redirect } from 'next/navigation';
import { screenById, screenOpen } from './screens';
import { assertDemo } from './server/demo-guard';
import { getSession } from './server/session';
import { nextLoginStep, type SessionView } from './session-view';

/**
 * Pola Server Action layar penunjang di mode presentasi (ADR-0023, pembangun-layar §7): gerbang demo, sesi lengkap,
 * posisi yang memakai layar, input divalidasi zod di action masing-masing, dan **tidak menyimpan apa pun**.
 */

export interface PenunjangActionResult {
  ok: boolean;
  /** Umpan balik ("… · 10.47 (simulasi, tidak disimpan)") atau pesan galat. */
  message: string;
  /** Jam aksi (WIB), mis. "10.47". */
  at?: string;
  /** Isian yang galat (untuk menandai field). */
  field?: string;
}

/** Sesi lengkap yang boleh memakai layar `screenId`; null bila posisinya bukan pemakai layar ini. */
export async function penunjangSession(screenId: string): Promise<SessionView | null> {
  assertDemo();
  const s = await getSession();
  if (!s || nextLoginStep(s, false) !== 'selesai') redirect('/masuk');
  const screen = screenById(screenId);
  if (!screen || !screenOpen(screen, { dataSource: 'demo', role: s.role?.code ?? null })) return null;
  return s;
}

export const DENIED: PenunjangActionResult = {
  ok: false,
  message: 'Posisi aktif Anda tidak memakai layar ini. Ganti posisi untuk melanjutkan.',
};

export function invalid(message: string, field?: string): PenunjangActionResult {
  return { ok: false, message, field };
}

/** Umpan balik sukses simulasi: "Validasi teknis tersimpan · 10.47 (simulasi, tidak disimpan)". */
export function simulated(text: string): PenunjangActionResult {
  const at = formatJam(new Date());
  return { ok: true, at, message: `${text} · ${at} (simulasi, tidak disimpan)` };
}
