import 'server-only';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { affectedBy, type DemoActor, project } from '../../demo/store/define';
import type { LogFile } from '../../demo/store/log';
import {
  allDomains,
  domainDef,
  type DomainName,
  type EventOf,
  type StateOf,
} from '../../demo/store/registry';
import { PRESENTATION_USERNAME_PREFIX } from '../../demo/personas';
import { screenById } from '../../screens';
import { nextLoginStep, type SessionView } from '../../session-view';
import { assertDemo } from '../demo-mode';
import { getSession } from '../session';
import { type CommitResult, DemoStateStore } from './state-store';
import { demoStateDir } from './store';

/**
 * API server toko demo bersama (ADR-0085). Hanya mode presentasi: setiap fungsi memanggil `assertDemo()` lebih dulu,
 * jadi di mode api toko tidak pernah dibaca atau ditulis.
 *
 * - Server component: `readDomain('hasil-kritis')` → `{ state, rev }` (keadaan RS demo sesi ini).
 * - Server Action domain: gerbang domain (cari rekaman di server), lalu `commitEvent(nama, kejadian, { rev })`.
 * - Server Action generik: `dispatchDemoEventAction` (`state-actions.ts`) untuk domain yang cukup dengan `validate`.
 */

const STORE_KEY = Symbol.for('simrs.demo-state-store');
export function demoStateStore(): DemoStateStore {
  const g = globalThis as { [STORE_KEY]?: { dir: string; store: DemoStateStore } };
  const dir = demoStateDir();
  if (g[STORE_KEY]?.dir !== dir) g[STORE_KEY] = { dir, store: new DemoStateStore(dir) };
  return g[STORE_KEY].store;
}

/** Sesi lengkap (MFA, sandi, unit) atau ke halaman masuk. */
async function demoSession(): Promise<SessionView> {
  assertDemo();
  const s = await getSession();
  if (!s || nextLoginStep(s, false) !== 'selesai') redirect('/masuk');
  return s;
}

/** Pelaku kejadian dari sesi server (termasuk posisi "Bertindak sebagai" Superadmin demo). */
export function demoActor(s: SessionView): DemoActor {
  const base = s.demoAllAccess?.baseRole?.code ?? null;
  return {
    userId: s.user.id,
    name: s.user.displayName,
    role: s.role?.code ?? null,
    baseRole: base && base !== s.role?.code ? base : null,
  };
}

/**
 * Ruang data demo sesi ini, sama dengan aturan toko skenario (ADR-0023 keputusan 9): semua akun presentasi (satu per
 * posisi, termasuk Superadmin demo) berbagi satu ruang per RS, sehingga aksi terlihat lintas posisi dan perangkat;
 * akun lain (akun uji, akun pengembang) punya ruang sendiri agar uji paralel tidak saling mengganggu.
 */
export function demoSpace(s: Pick<SessionView, 'tenant' | 'user'>): string {
  return s.user.username.startsWith(PRESENTATION_USERNAME_PREFIX)
    ? s.tenant.code
    : `${s.tenant.code}-${s.user.id.replace(/[^A-Za-z0-9]/g, '')}`;
}

/** Log ruang data sekali per render (React cache; di Server Action tidak di-cache sehingga selalu terkini). */
const loadLog = cache(async (space: string): Promise<LogFile> => demoStateStore().load(space));

export interface DomainView<S> {
  state: S;
  /** Kirim bersama setiap aksi; berbeda dari revisi terkini = tampilan basi. */
  rev: number;
}

/** Keadaan domain untuk ruang data demo sesi ini (fixture awal + kejadian tersimpan). */
export async function readDomain<N extends DomainName>(name: N): Promise<DomainView<StateOf<N>>> {
  const s = await demoSession();
  const { state, rev } = project(domainDef(name), await loadLog(demoSpace(s)));
  return { state: state as StateOf<N>, rev };
}

/** Ringkasan untuk menu "Data demo": jumlah kejadian dan mulai ulang terakhir. */
export async function demoStoreSummary(
  s: SessionView,
): Promise<{ events: number; lastReset: LogFile['lastReset'] }> {
  assertDemo();
  const log = await loadLog(demoSpace(s));
  return { events: log.events.length, lastReset: log.lastReset };
}

/** Muat ulang semua layar yang menampilkan domain `name` atau pelanggannya. */
export function revalidateDomain(name: DomainName): void {
  const defs = allDomains();
  const routes = new Set<string>();
  for (const d of affectedBy(name, defs)) {
    for (const id of defs.find((x) => x.name === d)?.screens ?? []) {
      const route = screenById(id)?.route;
      if (route) routes.add(route);
    }
  }
  for (const route of routes) revalidatePath(route);
}

/**
 * Catat kejadian `event` di domain `name` atas nama pengguna sesi. Pemanggil (Server Action domain) wajib sudah
 * memeriksa posisi dan gerbang domainnya; fungsi ini menegakkan mode presentasi, sesi lengkap, skema, revisi,
 * `validate` domain, dan batas ukuran, lalu memuat ulang layar terkait.
 */
export async function commitEvent<N extends DomainName>(
  name: N,
  event: EventOf<N>,
  opts: { rev: number; session?: SessionView },
): Promise<CommitResult> {
  assertDemo();
  const s = opts.session ?? (await demoSession());
  const r = await demoStateStore().commit(demoSpace(s), domainDef(name), event, {
    rev: opts.rev,
    actor: demoActor(s),
    at: new Date().toISOString(),
  });
  if (r.ok) revalidateDomain(name);
  return r;
}

/** Mulai ulang data demo ruang sesi ini (akun presentasi: seluruh RS) (pemanggil wajib memeriksa hak `canResetDemoData`). */
export async function resetDemoData(s: SessionView): Promise<void> {
  assertDemo();
  await demoStateStore().reset(demoSpace(s), demoActor(s), new Date().toISOString());
  revalidatePath('/', 'layout');
}
