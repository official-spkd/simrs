import 'server-only';
import { redirect } from 'next/navigation';
import { screenById, screenOpen } from './screens';
import { assertDemo } from './server/demo-guard';
import { getSession } from './server/session';
import { nextLoginStep, type SessionView } from './session-view';

/**
 * Gerbang Server Action layar manajemen (integrasi, logistik) di mode presentasi (ADR-0023, pembangun-layar §7):
 * gerbang demo, sesi lengkap, dan posisi yang memakai layar — sama dengan action penunjang/front office, sehingga
 * akun demo lain tidak bisa mengirim POST langsung ke action layar yang bukan untuk posisinya.
 */

/** Sesi lengkap yang boleh memakai layar `screenId`; null bila posisinya bukan pemakai layar ini. */
export async function manajemenSession(screenId: string): Promise<SessionView | null> {
  assertDemo();
  const s = await getSession();
  if (!s || nextLoginStep(s, false) !== 'selesai') redirect('/masuk');
  const screen = screenById(screenId);
  if (!screen || !screenOpen(screen, { dataSource: 'demo', role: s.role?.code ?? null })) return null;
  return s;
}

/** Pesan penolakan posisi (sama dengan layar penunjang). */
export const DENIED_MESSAGE = 'Posisi aktif Anda tidak memakai layar ini. Ganti posisi untuk melanjutkan.';
