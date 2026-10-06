import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALL_ACCESS_USERNAME } from '../../demo/personas';
import type { SessionView } from '../../session-view';
import { canReadGuide } from '../../session-view';

/** `cookies()` / `headers()` Next diganti peta sederhana yang diatur tiap tes. */
const req = vi.hoisted(() => ({ cookie: new Map<string, string>(), path: '/' }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (req.cookie.has(name) ? { value: req.cookie.get(name) } : undefined),
  }),
  headers: async () => ({ get: (name: string) => (name === 'x-simrs-path' ? req.path : null) }),
}));

const { isAllAccessAccount, parseActingRole, withDemoAllAccess } = await import('./all-access');

const dir = mkdtempSync(join(tmpdir(), 'simrs-demo-semua-'));
const file = join(dir, 'demo-accounts.json');
const saved = { ...process.env };

const account = (patch: Record<string, unknown> = {}) => ({
  username: ALL_ACCESS_USERNAME,
  password: 'sandi-acak-panjang-01',
  totpSecret: 'JBSWY3DPEHPK3PXPJBSWY3DP',
  displayName: 'Superadmin demo (presentasi)',
  role: 'manajemen',
  roleName: 'Superadmin demo · semua layar',
  unitName: null,
  allAccess: true,
  ...patch,
});
const writeAccounts = (accounts: unknown[], tenantCode = 'RSCM') =>
  writeFileSync(file, JSON.stringify({ format: 1, tenantCode, createdAt: '2026-10-06T00:00:00Z', accounts }));

const session = (patch: Partial<SessionView> = {}): SessionView => ({
  user: { id: 'u1', username: ALL_ACCESS_USERNAME, displayName: 'Superadmin demo', initials: 'SD' },
  tenant: { code: 'RSCM', name: 'RS Fiktif', kind: 'hospital' },
  role: { code: 'manajemen', name: 'Manajemen' },
  unit: null,
  permissions: ['audit.read'],
  mfaEnrolled: true,
  mfaVerified: true,
  mustChangePassword: false,
  ...patch,
});

beforeEach(() => {
  process.env.APP_ENV = 'local';
  process.env.DATA_SOURCE = 'demo';
  process.env.DEMO_ACCOUNTS_FILE = file;
  req.cookie.clear();
  req.path = '/';
  writeAccounts([account()]);
});
afterEach(() => {
  process.env = { ...saved };
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('Superadmin demo · pengenalan akun (ADR-0023 keputusan 10)', () => {
  it('mode presentasi + nama pengguna API + entri allAccess di berkas lokal untuk RS yang sama → true', async () => {
    expect(await isAllAccessAccount(session())).toBe(true);
  });

  it('gagal aman: mode api/staging/produksi, nama lain, RS lain, tenant PLATFORM, atau berkas tanpa tanda → false', async () => {
    process.env.DATA_SOURCE = 'api';
    expect(await isAllAccessAccount(session())).toBe(false);
    process.env.DATA_SOURCE = 'demo';
    process.env.APP_ENV = 'staging';
    expect(await isAllAccessAccount(session())).toBe(false);
    delete process.env.APP_ENV; // tak disetel = produksi
    expect(await isAllAccessAccount(session())).toBe(false);
    process.env.APP_ENV = 'local';

    const other = session({
      user: { id: 'u2', username: 'presentasi.direksi', displayName: 'X', initials: 'X' },
    });
    expect(await isAllAccessAccount(other)).toBe(false);
    expect(
      await isAllAccessAccount(session({ tenant: { code: 'RSFA', name: 'RS', kind: 'hospital' } })),
    ).toBe(false);
    expect(
      await isAllAccessAccount(session({ tenant: { code: 'RSCM', name: 'Platform', kind: 'platform' } })),
    ).toBe(false);
    writeAccounts([account({ allAccess: undefined })]);
    expect(await isAllAccessAccount(session())).toBe(false);
    rmSync(file, { force: true });
    expect(await isAllAccessAccount(session())).toBe(false);
  });

  it('cookie "Bertindak sebagai" hanya peran RS yang dikenal', () => {
    expect(parseActingRole('dokter')).toBe('dokter');
    expect(parseActingRole('superadmin_platform')).toBeNull();
    expect(parseActingRole('__proto__')).toBeNull();
    expect(parseActingRole(undefined)).toBeNull();
  });
});

describe('withDemoAllAccess', () => {
  it('posisi per layar: pemakai pertama layar, atau pilihan presenter bila layar memakainya', async () => {
    req.path = '/klinis/rawat-inap/0199a1b2-0000-7000-8000-000000000001';
    const s = await withDemoAllAccess(session());
    expect(s.role).toEqual({ code: 'dokter', name: 'Dokter (DPJP)' });
    expect(s.demoAllAccess).toEqual({
      baseRole: { code: 'manajemen', name: 'Manajemen' },
      preferredRole: null,
    });
    // Izin API tidak berubah: tetap izin peran asli.
    expect(s.permissions).toEqual(['audit.read']);

    req.cookie.set('simrs_demo_bertindak', 'perawat');
    expect((await withDemoAllAccess(session())).role?.code).toBe('perawat');
    req.path = '/keuangan/kasir';
    expect((await withDemoAllAccess(session())).role?.code).toBe('kasir');
    req.path = '/';
    expect((await withDemoAllAccess(session())).role?.code).toBe('perawat');
    req.cookie.set('simrs_demo_bertindak', 'superadmin_platform');
    expect((await withDemoAllAccess(session())).role?.code).toBe('manajemen');
  });

  it('akun lain atau mode api: sesi dikembalikan apa adanya (tanpa tanda, tanpa ganti posisi)', async () => {
    req.path = '/keuangan/kasir';
    const other = session({
      user: { id: 'u2', username: 'presentasi.direksi', displayName: 'X', initials: 'X' },
    });
    expect(await withDemoAllAccess(other)).toBe(other);
    process.env.DATA_SOURCE = 'api';
    const s = session();
    expect(await withDemoAllAccess(s)).toBe(s);
  });

  it('panduan: operator platform selalu; Superadmin demo hanya di mode presentasi', async () => {
    const s = await withDemoAllAccess(session());
    expect(canReadGuide(s, 'demo')).toBe(true);
    expect(canReadGuide(s, 'api')).toBe(false);
    expect(canReadGuide(session(), 'demo')).toBe(false);
    const operator = session({
      tenant: { code: 'PLATFORM', name: 'Platform', kind: 'platform' },
      permissions: ['platform.guide.read'],
    });
    expect(canReadGuide(operator, 'api')).toBe(true);
  });
});
