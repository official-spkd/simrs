import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionView } from '../../session-view';

const current = vi.hoisted(() => ({ session: null as SessionView | null, revalidated: [] as string[] }));
vi.mock('@/lib/server/session', () => ({ getSession: async () => current.session }));
vi.mock('next/cache', () => ({
  revalidatePath: (path: string, type?: string) => current.revalidated.push(type ? `${path}|${type}` : path),
}));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`);
  },
}));

const { dispatchDemoEventAction, demoDataSummaryAction, resetDemoDataAction } =
  await import('./state-actions');
const { commitEvent, readDomain } = await import('./state');

const dir = mkdtempSync(join(tmpdir(), 'simrs-demo-toko-aksi-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function as(role: string | null, opts: { allAccess?: boolean; tenant?: string } = {}): SessionView {
  return {
    user: { id: 'u-1', username: 'uji', displayName: 'Akun Uji', initials: 'AU' },
    tenant: { code: opts.tenant ?? 'RSAKSI', name: 'RS Uji', kind: 'hospital' },
    role: role ? { code: role, name: role } : null,
    unit: null,
    permissions: [],
    mfaEnrolled: true,
    mfaVerified: true,
    mustChangePassword: false,
    ...(opts.allAccess
      ? { demoAllAccess: { baseRole: { code: 'manajemen', name: 'Manajemen' }, preferredRole: null } }
      : {}),
  };
}

const report = (itemId: string) => ({
  type: 'laporan.dicatat' as const,
  itemId,
  recipient: 'dr. Penerima Uji',
  recipientRole: 'DPJP',
  channel: 'telepon' as const,
  reportedAt: '2026-10-05T03:52:00.000Z',
  via: 'pusat' as const,
});

function demoMode() {
  vi.stubEnv('APP_ENV', 'local');
  vi.stubEnv('DATA_SOURCE', 'demo');
  vi.stubEnv('DEMO_STATE_DIR', dir);
}

describe('toko demo: gerbang mode presentasi', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    current.session = as('analis_lab');
    current.revalidated = [];
  });

  it('mode api: toko tidak dibaca dan Server Action menolak', async () => {
    vi.stubEnv('APP_ENV', 'local');
    vi.stubEnv('DATA_SOURCE', 'api');
    vi.stubEnv('DEMO_STATE_DIR', dir);
    await expect(readDomain('hasil-kritis')).rejects.toThrow(/Mode presentasi tidak aktif/);
    await expect(commitEvent('hasil-kritis', report('kr-A'), { rev: 0 })).rejects.toThrow(/tidak aktif/);
    await expect(dispatchDemoEventAction('hasil-kritis', report('kr-A'), 0)).rejects.toThrow(/tidak aktif/);
    await expect(resetDemoDataAction(true)).rejects.toThrow(/tidak aktif/);
    await expect(demoDataSummaryAction()).rejects.toThrow(/tidak aktif/);
    vi.stubEnv('APP_ENV', 'staging');
    vi.stubEnv('DATA_SOURCE', 'demo');
    await expect(readDomain('hasil-kritis')).rejects.toThrow(/tidak aktif/);
  });

  it('tanpa sesi lengkap → ke halaman masuk', async () => {
    demoMode();
    current.session = null;
    await expect(readDomain('hasil-kritis')).rejects.toThrow('redirect /masuk');
    await expect(resetDemoDataAction(true)).rejects.toThrow('redirect /masuk');
  });
});

describe('toko demo: tulis, baca, mulai ulang', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    demoMode();
    current.revalidated = [];
  });

  it('commitEvent mencatat pelaku dari sesi dan memuat ulang layar domain', async () => {
    current.session = as('analis_lab', { tenant: 'RSTULIS' });
    const r = await commitEvent('hasil-kritis', report('kr-A'), { rev: 0 });
    expect(r).toMatchObject({ ok: true, rev: 1 });
    const view = await readDomain('hasil-kritis');
    expect(view.rev).toBe(1);
    expect(view.state.reports['kr-A']?.reportedBy).toBe('Akun Uji');
    expect(current.revalidated).toEqual(['/penunjang/lab', '/penunjang/hasil-kritis']);
    expect(await commitEvent('hasil-kritis', report('kr-B'), { rev: 0 })).toMatchObject({ stale: true });
  });

  it('Bertindak sebagai: posisi yang dibawakan + penugasan asli tercatat', async () => {
    current.session = as('analis_lab', { tenant: 'RSACT', allAccess: true });
    await commitEvent('hasil-kritis', report('kr-A'), { rev: 0 });
    const { demoStateStore } = await import('./state');
    const log = await demoStateStore().load('RSACT');
    expect(log.events[0]?.actor).toEqual({
      userId: 'u-1',
      name: 'Akun Uji',
      role: 'analis_lab',
      baseRole: 'manajemen',
    });
  });

  it('Server Action generik hanya untuk domain generik yang dikenal', async () => {
    current.session = as('analis_lab', { tenant: 'RSGEN' });
    expect(await dispatchDemoEventAction('tidak-ada', {}, 0)).toMatchObject({ ok: false });
    expect(await dispatchDemoEventAction('__proto__', {}, 0)).toMatchObject({ ok: false });
    // hasil-kritis butuh gerbang server (sampel/hasil kritis terbuka): tidak boleh lewat aksi generik.
    expect(await dispatchDemoEventAction('hasil-kritis', report('kr-A'), 0)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/layarnya sendiri/),
    });
    expect(await dispatchDemoEventAction('hasil-kritis', report('kr-A'), -1)).toMatchObject({ ok: false });
    expect((await readDomain('hasil-kritis')).rev).toBe(0);
  });

  it('mulai ulang: hanya admin SIM RS, manajemen, atau Superadmin demo, dengan konfirmasi', async () => {
    current.session = as('analis_lab', { tenant: 'RSULANG' });
    await commitEvent('hasil-kritis', report('kr-A'), { rev: 0 });
    expect(await resetDemoDataAction(true)).toMatchObject({ ok: false });
    expect((await demoDataSummaryAction()).canReset).toBe(false);

    current.session = as('admin_tenant', { tenant: 'RSULANG' });
    expect(await resetDemoDataAction('ya')).toMatchObject({ ok: false, message: /Konfirmasi/ });
    expect((await demoDataSummaryAction()).events).toBe(1);
    expect(await resetDemoDataAction(true)).toMatchObject({ ok: true });
    expect(current.revalidated).toContain('/|layout');
    const sum = await demoDataSummaryAction();
    expect(sum).toMatchObject({ events: 0, canReset: true, lastReset: { by: 'Akun Uji' } });
    expect((await readDomain('hasil-kritis')).state.reports).toEqual({});

    for (const s of [
      as('manajemen', { tenant: 'RSULANG' }),
      as('perawat', { tenant: 'RSULANG', allAccess: true }),
    ]) {
      current.session = s;
      expect((await resetDemoDataAction(true)).ok).toBe(true);
    }
  });

  it('toko per RS: RS lain tidak melihat aksi RS ini', async () => {
    current.session = as('analis_lab', { tenant: 'RSSATU' });
    await commitEvent('hasil-kritis', report('kr-A'), { rev: 0 });
    current.session = as('analis_lab', { tenant: 'RSDUA' });
    expect((await readDomain('hasil-kritis')).state.reports).toEqual({});
  });
});
