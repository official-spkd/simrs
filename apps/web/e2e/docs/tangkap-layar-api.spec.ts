import { expect, test } from '@playwright/test';
import { DOCS_CAPTURE, openAs, shoot, watchErrors } from './capture';

/**
 * Tangkap layar dokumentasi · mode api (layar yang tersambung backend: platform fase 1, Kendali antrean, panduan).
 * Data = isi database tes E2E (tenant RSFA fiktif + fixture global setup). Jalankan lewat `pnpm docs:gambar`.
 */

test.skip(!DOCS_CAPTURE, 'Hanya dengan DOCS_CAPTURE=1 (pnpm docs:gambar)');

/** Gambar → (peran, rute). Peran = pemakai utama layar menurut matriks izin bawaan. */
/** `unitName`: penugasan terikat unit (PIN masuk cepat hanya untuk posisi ber-unit). */
const API_SCREENS: ReadonlyArray<{ name: string; role: string; path: string; unitName?: string }> = [
  { name: 'akses', role: 'admin_tenant', path: '/sistem/akses' },
  { name: 'audit', role: 'petugas_privasi', path: '/sistem/audit' },
  { name: 'mpi', role: 'petugas_rm', path: '/rekam-medis/mpi' },
  { name: 'formulir', role: 'petugas_rm', path: '/sistem/formulir' },
  { name: 'notifikasi', role: 'petugas_privasi', path: '/notifikasi' },
  { name: 'pin', role: 'perawat', path: '/akun/pin', unitName: 'Bangsal Melati' },
  { name: 'kendali', role: 'petugas_pendaftaran', path: '/antrean' },
];

test.describe('dokumentasi · layar mode api', () => {
  test('masuk (layar masuk, belum login)', async ({ page }, info) => {
    const errors = watchErrors(page);
    await page.goto('/masuk');
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await shoot(page, info, 'masuk');
    expect(errors()).toEqual([]);
  });

  for (const s of API_SCREENS) {
    test(`${s.name} (${s.role})`, async ({ page }, info) => {
      await openAs(page, s.role, s.path, { unitName: s.unitName });
      const errors = watchErrors(page);
      const res = await page.goto(s.path);
      expect(res?.status(), `${s.path}: status HTTP`).toBe(200);
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      await shoot(page, info, s.name);
      expect(errors(), `${s.path}: galat JavaScript`).toEqual([]);
    });
  }

  test('panduan (indeks panduan superadmin)', async ({ page }, info) => {
    await openAs(page, 'superadmin_platform', '/superadmin/panduan', { tenant: 'PLATFORM' });
    await expect(page.getByRole('heading', { name: 'Panduan sistem SIM RS', level: 1 })).toBeVisible();
    await shoot(page, info, 'panduan');
    // Halaman fitur dengan gambar (memeriksa penyajian gambar panduan sekaligus).
    await page.goto('/superadmin/panduan/fitur-klinis');
    const shot = page.getByRole('article').locator('img[src$="/poli.png"]');
    await shot.scrollIntoViewIfNeeded();
    await expect.poll(() => shot.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    await shoot(page, info, 'panduan--fitur', { focus: shot });
  });
});
