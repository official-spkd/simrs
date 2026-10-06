'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { nextLoginStep } from '../../session-view';
import { assertDemo } from '../demo-mode';
import { getSession } from '../session';
import { parseActingRole, writeActingRole } from './all-access';

/**
 * "Bertindak sebagai" Superadmin demo (ADR-0023 keputusan 10). Endpoint POST publik: gerbang mode presentasi, sesi
 * lengkap, sesi harus Superadmin demo yang diverifikasi server, dan peran harus peran RS yang dikenal. Hanya mengubah
 * tampilan layar ber-data dummy; API tidak tersentuh.
 */
export async function setActingRoleAction(role: string | null): Promise<{ error?: string }> {
  assertDemo();
  const s = await getSession();
  if (!s || nextLoginStep(s, false) !== 'selesai') redirect('/masuk');
  if (!s.demoAllAccess) {
    return { error: 'Hanya posisi Superadmin demo yang bisa bertindak sebagai posisi lain.' };
  }
  const parsed = role === null ? null : parseActingRole(role);
  if (role !== null && !parsed) return { error: 'Posisi tidak dikenal.' };
  await writeActingRole(parsed);
  revalidatePath('/', 'layout');
  return {};
}
