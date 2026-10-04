import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadPresentationAccounts, publicPersonas } from './accounts';

const dir = mkdtempSync(join(tmpdir(), 'simrs-demo-akun-'));
const file = join(dir, 'demo-accounts.json');
const saved = { ...process.env };

const valid = {
  format: 1 as const,
  tenantCode: 'RSCM',
  createdAt: '2026-10-04T10:00:00.000Z',
  accounts: [
    {
      username: 'presentasi.perawat',
      password: 'sandi-acak-panjang-01',
      totpSecret: 'JBSWY3DPEHPK3PXPJBSWY3DP',
      displayName: 'Ns. Maya Sari, S.Kep',
      role: 'perawat',
      roleName: 'Perawat',
      unitName: 'Bangsal Melati',
    },
  ],
};

beforeEach(() => {
  process.env.APP_ENV = 'local';
  process.env.DATA_SOURCE = 'demo';
  process.env.DEMO_ACCOUNTS_FILE = file;
});
afterEach(() => {
  process.env = { ...saved };
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('berkas akun presentasi', () => {
  it('dibaca hanya di mode presentasi; tampilan publik tanpa sandi dan rahasia TOTP', async () => {
    writeFileSync(file, JSON.stringify(valid));
    const r = await loadPresentationAccounts();
    expect(r?.accounts).toHaveLength(1);
    const pub = publicPersonas(r ?? valid);
    expect(JSON.stringify(pub)).not.toContain('sandi-acak');
    expect(JSON.stringify(pub)).not.toContain('JBSWY3DP');
    expect(pub[0]).toEqual({
      username: 'presentasi.perawat',
      displayName: 'Ns. Maya Sari, S.Kep',
      role: 'perawat',
      roleName: 'Perawat',
      unitName: 'Bangsal Melati',
    });
  });

  it('berkas hilang, rusak, atau tidak sesuai skema → null (layar masuk menampilkan cara membuatnya)', async () => {
    rmSync(file, { force: true });
    expect(await loadPresentationAccounts()).toBeNull();
    writeFileSync(file, '{rusak');
    expect(await loadPresentationAccounts()).toBeNull();
    writeFileSync(
      file,
      JSON.stringify({ ...valid, accounts: [{ ...valid.accounts[0], totpSecret: 'bukan base32!' }] }),
    );
    expect(await loadPresentationAccounts()).toBeNull();
  });

  it('di luar mode presentasi ditolak keras (staging/produksi tidak pernah membaca kredensial)', async () => {
    writeFileSync(file, JSON.stringify(valid));
    process.env.APP_ENV = 'staging';
    await expect(loadPresentationAccounts()).rejects.toThrow('Mode presentasi tidak aktif');
    process.env.APP_ENV = 'local';
    process.env.DATA_SOURCE = 'api';
    await expect(loadPresentationAccounts()).rejects.toThrow('Mode presentasi tidak aktif');
  });
});
