import 'server-only';
import { redirect } from 'next/navigation';
import { DEMO_NOW } from '../../demo/fixtures/waktu';
import { periodLockMessage } from '../../keuangan-akuntansi-toko';
import { screenById, screenOpen } from '../../screens';
import { nextLoginStep, type SessionView } from '../../session-view';
import { readDomain } from '../demo/state';
import { assertDemo } from '../demo-guard';
import { getSession } from '../session';

/**
 * Bantuan Server Action keuangan di atas toko demo bersama (ADR-0085): gerbang mode presentasi + sesi lengkap + posisi
 * aktif yang memakai layar, jam demo server, dan kunci periode akuntansi untuk setiap mutasi uang.
 */

/** Sesi lengkap yang posisinya memakai layar `screenId` (Superadmin demo: "Bertindak sebagai"), atau null. */
export async function keuanganSession(screenId: string): Promise<SessionView | null> {
  assertDemo();
  const s = await getSession();
  if (!s || nextLoginStep(s, false) !== 'selesai') redirect('/masuk');
  const screen = screenById(screenId);
  const ok =
    !!screen &&
    screenOpen(screen, {
      dataSource: 'demo',
      role: s.role?.code ?? null,
      allAccess: Boolean(s.demoAllAccess),
    });
  return ok ? s : null;
}

/** Saat modul server dimuat: jam demo berjalan dari `DEMO_NOW` mengikuti jam dinding. */
const CLOCK_START = Date.now();

/**
 * Jam demo server (ISO WIB, hari presentasi 5 Okt 2026) untuk stempel kejadian keuangan: tanggal jurnal selalu di
 * periode demo, apa pun tanggal komputer presenter.
 */
export function demoStamp(): string {
  const t = new Date(Date.parse(DEMO_NOW) + (Date.now() - CLOCK_START));
  const wib = new Date(t.getTime() + 7 * 3_600_000).toISOString().slice(0, 19);
  return `${wib}+07:00`;
}

/** Penolakan mutasi uang bertanggal `at` bila periode akuntansinya sudah ditutup (null = boleh). */
export async function periodLock(at: string): Promise<string | null> {
  const { state } = await readDomain('akuntansi');
  return periodLockMessage(state, at);
}

export const NOT_YOUR_SCREEN = 'Posisi aktif tidak memakai layar ini. Ganti posisi untuk melanjutkan.';
export const BAD_INPUT = 'Isian tidak lengkap atau tidak sah.';

/** Hasil Server Action keuangan (umpan balik + tanda tampilan basi). */
export interface KeuanganActionResult {
  ok: boolean;
  message: string;
  /** Tampilan basi: halaman dimuat ulang. */
  stale?: boolean;
}
