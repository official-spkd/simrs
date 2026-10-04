import { expect, test } from '@playwright/test';
import { SCREENS } from '../src/lib/screens';
import { createAccount, loginAs } from './support/accounts';
import { CONSENT_ID, ENCOUNTER_ID } from '../src/lib/demo/fixtures/ids';

test.describe('smoke', () => {
  test('/masuk tampil tanpa login, berbahasa Indonesia, dengan header keamanan', async ({ page }) => {
    const res = await page.goto('/masuk');
    expect(res?.status()).toBe(200);
    await expect(page.locator('html')).toHaveAttribute('lang', 'id');
    await expect(page.getByRole('heading', { name: 'Masuk ke SIM RS' })).toBeVisible();
    const headers = res?.headers() ?? {};
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(headers['x-frame-options']).toBe('DENY');
  });

  test('beranda: menu sesuai peran; menu yang belum dibangun tidak bisa diklik', async ({
    page,
    viewport,
  }) => {
    const account = await createAccount({ roles: ['perawat'] });
    await loginAs(page, account);
    await expect(page.getByRole('heading', { name: 'Beranda', level: 1 })).toBeVisible();
    // Di luar mode presentasi tidak ada lencana data fiktif (ADR-0023).
    await expect(page.getByText('Mode presentasi · data fiktif')).toHaveCount(0);
    if ((viewport?.width ?? 1280) < 768) return;
    const nav = page.getByRole('navigation', { name: 'Navigasi utama' });
    const igd = nav.getByTitle('IGD · layar belum tersedia').first();
    await expect(igd).toHaveAttribute('aria-disabled', 'true');
    await expect(nav.getByRole('link', { name: 'IGD' })).toHaveCount(0);
    // Perawat tidak memegang izin kelola pengguna: menunya tidak tampil.
    await expect(nav.getByText('Pengguna & akses')).toHaveCount(0);
    await expect(nav.getByText('Perawat', { exact: true })).toHaveCount(1);
    await expect(nav.getByText('Semua unit', { exact: true })).toBeVisible();
  });

  test('layar mode presentasi tidak ada di luar mode demo (404)', async ({ page }) => {
    const account = await createAccount({ roles: ['perawat'] });
    await loginAs(page, account);
    const paths = [
      ...SCREENS.filter((s) => s.status === 'demo').map((s) => s.route),
      `/klinis/order/${ENCOUNTER_ID.suryo}`,
      `/klinis/rawat-inap/${ENCOUNTER_ID.hartono}`,
      `/klinis/resume/${ENCOUNTER_ID.hartono}`,
      `/tablet/persetujuan/${CONSENT_ID.hartono}`,
    ];
    for (const path of paths) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBe(404);
    }
  });

  test.describe('/dev/ui (operator platform)', () => {
    test.beforeEach(async ({ page }) => {
      const operator = await createAccount({ tenant: 'PLATFORM', roles: ['superadmin_platform'] });
      await loginAs(page, operator, '/dev/ui');
    });

    test('gerbang alasan pembatalan bekerja', async ({ page }) => {
      await expect(page.getByRole('heading', { name: 'Klinis Bersih' })).toBeVisible();
      await page.getByRole('button', { name: 'Batalkan tindakan' }).click();
      const confirm = page.getByRole('button', { name: 'Ya, batalkan' });
      await expect(confirm).toBeDisabled();
      await page.getByLabel('Alasan pembatalan').fill('Pasien menolak tindakan');
      await expect(confirm).toBeEnabled();
      await confirm.click();
      await expect(
        page.getByRole('status').filter({ hasText: 'dibatalkan dengan alasan tercatat' }),
      ).toBeVisible();
    });

    test('validasi NIK menjelaskan cara memperbaiki', async ({ page }) => {
      const nik = page.getByLabel(/^NIK/);
      await nik.fill('12345');
      await expect(page.getByText('NIK harus 16 digit (sekarang 5).')).toBeVisible();
      await expect(nik).toHaveAttribute('aria-invalid', 'true');
      await nik.fill('9999010101900001');
      await expect(page.getByText('Format benar · siap dicek ke Dukcapil')).toBeVisible();
    });

    test('setiap kontrol interaktif galeri setinggi ≥ 44 px (target sentuh)', async ({ page }, testInfo) => {
      await expect(page.getByRole('heading', { name: 'Klinis Bersih' })).toBeVisible();
      // Tampilkan juga field dan tombol ringkas (sm) di formulir alasan pembatalan.
      await page.getByRole('button', { name: 'Batalkan tindakan' }).click();
      await expect(page.getByLabel('Alasan pembatalan')).toBeVisible();
      const { checked, extended, small } = await page.locator('main').evaluate((main) => {
        const out: string[] = [];
        let n = 0;
        let ext = 0;
        const sel = 'button, a[href], input, select, textarea, summary';
        for (const el of main.querySelectorAll<HTMLElement>(sel)) {
          if (el.offsetParent === null) continue;
          n += 1;
          el.scrollIntoView({ block: 'center' });
          const r = el.getBoundingClientRect();
          let h = r.height;
          if (h < 44) {
            // Segmen ringkas: area sentuh diperluas ::before; 3 px di atas/bawah tombol tetap mengenai tombol itu.
            const x = r.left + r.width / 2;
            const up = document.elementFromPoint(x, r.top - 3);
            const down = document.elementFromPoint(x, r.bottom + 3);
            if (up === el && down === el) {
              h = r.height + 8;
              ext += 1;
            }
          }
          if (h < 44)
            out.push(`${el.tagName} "${(el.textContent ?? '').trim().slice(0, 30)}" ${Math.round(h)} px`);
        }
        return { checked: n, extended: ext, small: out };
      });
      expect(small).toEqual([]);
      expect(checked).toBeGreaterThan(20);
      // Tiga pilihan Segmen memakai area sentuh yang diperluas (tampak 36 px).
      expect(extended).toBe(3);
      await page.screenshot({ path: testInfo.outputPath('dev-ui-kontrol.png'), fullPage: true });
    });

    test('tidak ada scroll horizontal', async ({ page }) => {
      for (const path of ['/', '/dev/ui', '/superadmin/panduan']) {
        await page.goto(path);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow, path).toBeLessThanOrEqual(0);
      }
    });
  });

  test('/masuk tanpa scroll horizontal', async ({ page }) => {
    await page.goto('/masuk');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
