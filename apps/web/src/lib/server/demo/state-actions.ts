'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { canResetDemoData } from '../../demo/store/access';
import { domainDef, isDomainName } from '../../demo/store/registry';
import { screenById, screenOpen } from '../../screens';
import { nextLoginStep } from '../../session-view';
import { assertDemo } from '../demo-mode';
import { getSession } from '../session';
import { commitEvent, demoSpace, demoStoreSummary, resetDemoData } from './state';

/**
 * Server Action toko demo bersama (ADR-0085). Endpoint POST publik: gerbang mode presentasi, sesi lengkap, input
 * divalidasi di sini. Pelaku selalu dari sesi (`commitEvent`), tidak pernah dari kiriman klien.
 */

export interface DemoDispatchResult {
  ok: boolean;
  /** Pesan galat (Bahasa Indonesia) bila ditolak. */
  error?: string;
  /** Tampilan basi: muat ulang lalu ulangi. */
  stale?: boolean;
  /** Revisi domain sesudah aksi. */
  rev?: number;
}

async function completeSession() {
  assertDemo();
  const s = await getSession();
  if (!s || nextLoginStep(s, false) !== 'selesai') redirect('/masuk');
  return s;
}

const NOT_YOUR_SCREEN = 'Posisi aktif Anda tidak memakai layar ini. Ganti posisi untuk melanjutkan.';

/**
 * Kirim kejadian ke domain `name` (generik, untuk domain yang aturannya cukup dengan `validate` murni). Posisi aktif
 * harus memakai salah satu layar domain; skema, revisi, dan `validate` ditegakkan toko.
 */
export async function dispatchDemoEventAction(
  name: string,
  event: unknown,
  rev: number,
): Promise<DemoDispatchResult> {
  const s = await completeSession();
  if (typeof name !== 'string' || !isDomainName(name))
    return { ok: false, error: 'Domain data demo tidak dikenal.' };
  if (!Number.isSafeInteger(rev) || rev < 0) return { ok: false, error: 'Revisi data demo tidak sah.' };
  const def = domainDef(name);
  if (!def.generic) return { ok: false, error: 'Aksi ini harus dikirim dari layarnya sendiri.' };
  const allowed = def.screens.some((id) => {
    const screen = screenById(id);
    return (
      !!screen &&
      screenOpen(screen, {
        dataSource: 'demo',
        role: s.role?.code ?? null,
        allAccess: Boolean(s.demoAllAccess),
      })
    );
  });
  if (!allowed) return { ok: false, error: NOT_YOUR_SCREEN };
  // Isi kiriman klien belum bertipe; toko memvalidasinya dengan skema domain sebelum apa pun dicatat.
  const r = await commitEvent(name, event as never, { rev, session: s });
  return r.ok ? { ok: true, rev: r.rev } : { ok: false, error: r.error, stale: r.stale };
}

/** Mulai ulang data demo RS ini. Hanya admin SIM RS, manajemen, atau Superadmin demo; wajib dikonfirmasi. */
export async function resetDemoDataAction(confirm: unknown): Promise<{ ok: boolean; message: string }> {
  const s = await completeSession();
  if (!canResetDemoData(s)) {
    return {
      ok: false,
      message: 'Hanya admin SIM RS, manajemen, atau Superadmin demo yang bisa memulai ulang data demo.',
    };
  }
  if (!z.literal(true).safeParse(confirm).success)
    return { ok: false, message: 'Konfirmasi mulai ulang diperlukan.' };
  await resetDemoData(s);
  return { ok: true, message: `Data demo ${s.tenant.name} kembali ke keadaan awal.` };
}

export interface DemoDataSummary {
  tenantName: string;
  /** true = ruang bersama akun presentasi RS ini; false = ruang akun ini saja (akun uji/pengembang). */
  shared: boolean;
  /** Jumlah aksi tersimpan di toko RS ini. */
  events: number;
  lastReset: { at: string; by: string } | null;
  canReset: boolean;
}

/** Ringkasan untuk menu data demo di header (dibaca saat menu dibuka, jadi selalu terkini). */
export async function demoDataSummaryAction(): Promise<DemoDataSummary> {
  const s = await completeSession();
  const sum = await demoStoreSummary(s);
  return {
    tenantName: s.tenant.name,
    shared: demoSpace(s) === s.tenant.code,
    events: sum.events,
    lastReset: sum.lastReset ? { at: sum.lastReset.at, by: sum.lastReset.actor.name } : null,
    canReset: canResetDemoData(s),
  };
}
