import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionView } from './session-view';
import { LAB_SAMPLE_ID } from './demo/fixtures/ids';
import { PRESET_MESSAGES } from './demo/fixtures/integrasi-perangkat';
const ctx = vi.hoisted(() => ({ session: null as SessionView | null }));
vi.mock('@/lib/server/session', () => ({ getSession: async () => ctx.session }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`);
  },
}));
const { validateLabAction } = await import('@/app/(staf)/penunjang/lab/actions-demo');
const { processHl7Action } = await import('@/app/(staf)/sistem/integrasi/perangkat/actions');
const { apiClientAction } = await import('@/app/(staf)/sistem/integrasi/api-publik/actions');
const { readDomain, resetDemoData } = await import('./server/demo/state');
const dir = mkdtempSync(join(tmpdir(), 'simrs-cx1-aksi-'));
afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});
let seq = 0;
function session(role: string): SessionView {
  return {
    user: { id: `u${seq}`, username: 'uji', displayName: 'Petugas sesi nyata', initials: 'PN' },
    tenant: { code: `RSCX${seq}`, name: 'RS tes', kind: 'hospital' },
    role: { code: role, name: role },
    unit: null,
    permissions: [],
    mfaEnrolled: true,
    mfaVerified: true,
    mustChangePassword: false,
  };
}
describe('Aksi Penunjang/Integrasi: penyimpanan server', () => {
  beforeEach(() => {
    seq++;
    ctx.session = session('analis_lab');
    vi.stubEnv('APP_ENV', 'local');
    vi.stubEnv('DATA_SOURCE', 'demo');
    vi.stubEnv('DEMO_STATE_DIR', dir);
  });
  it('validasi tersimpan atas nama sesi, rev basi ditolak dan reset mengembalikan fixture', async () => {
    expect(await validateLabAction({ sampleId: LAB_SAMPLE_ID.endang, level: 'teknis' }, 0)).toMatchObject({
      ok: true,
      message: /Petugas sesi nyata/,
    });
    const view = await readDomain('penunjang');
    expect(view.state.samples.find((x) => x.id === LAB_SAMPLE_ID.endang)?.technical?.by).toBe(
      'Petugas sesi nyata',
    );
    expect(view.rev).toBe(1);
    expect(await validateLabAction({ sampleId: LAB_SAMPLE_ID.yusuf, level: 'teknis' }, 0)).toMatchObject({
      stale: true,
    });
    await resetDemoData(ctx.session!);
    expect(
      (await readDomain('penunjang')).state.samples.find((x) => x.id === LAB_SAMPLE_ID.endang)?.technical,
    ).toBeNull();
  });
  it('gateway tidak percaya daftar processed klien, draf masuk Lab dan log PID tersamar', async () => {
    ctx.session = session('admin_tenant');
    const result = await processHl7Action(
      { raw: PRESET_MESSAGES[0]!.raw, processed: ['HEM-261005-0418'] },
      0,
    );
    expect(result).toMatchObject({ ok: true, result: { ack: 'AA', status: 'dicocokkan' } });
    expect('redacted' in result ? result.redacted : null).not.toContain('00-31-77-02');
    expect(
      (await readDomain('penunjang')).state.samples.find((x) => x.labNo === 'L2610050163')?.results[0]?.value,
    ).toBe(11.8);
    expect((await readDomain('integrasi')).state.gatewayLog[0]?.redacted).toContain('PID|||•••');
    expect(await processHl7Action({ raw: PRESET_MESSAGES[0]!.raw }, 1)).toMatchObject({
      result: { status: 'duplikat' },
    });
  });
  it('pendaftaran klien bertahan dan rotasi id palsu ditolak', async () => {
    ctx.session = session('admin_tenant');
    expect(
      await apiClientAction(
        {
          kind: 'daftar',
          name: 'Mitra uji',
          purpose: 'Mengambil data fiktif',
          scopes: ['Observation.read'],
          basis: 'Persetujuan demo fiktif',
        },
        0,
      ),
    ).toMatchObject({ ok: true });
    expect((await readDomain('integrasi')).state.clients).toContainEqual(
      expect.objectContaining({ name: 'Mitra uji' }),
    );
    expect(await apiClientAction({ kind: 'rotasi', clientId: 'palsu', confirmed: true }, 1)).toMatchObject({
      ok: false,
      message: /tidak terdaftar/,
    });
  });
  it('peran tak berhak tidak menulis dan mode api menolak seluruh aksi', async () => {
    ctx.session = session('perawat');
    expect(await apiClientAction({ kind: 'aktifkan', clientId: 'palsu' }, 0)).toMatchObject({ ok: false });
    expect((await readDomain('integrasi')).rev).toBe(0);
    vi.stubEnv('DATA_SOURCE', 'api');
    await expect(validateLabAction({ sampleId: LAB_SAMPLE_ID.endang, level: 'teknis' }, 0)).rejects.toThrow(
      /tidak aktif/,
    );
    await expect(processHl7Action({}, 0)).rejects.toThrow(/tidak aktif/);
    await expect(apiClientAction({}, 0)).rejects.toThrow(/tidak aktif/);
  });
});
