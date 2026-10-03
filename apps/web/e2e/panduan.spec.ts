import { expect, test } from '@playwright/test';
import { createAccount, loginAs } from './support/accounts';

test.describe('panduan superadmin (peran superadmin_platform)', () => {
  test.beforeEach(async ({ page }) => {
    const operator = await createAccount({ tenant: 'PLATFORM', roles: ['superadmin_platform'] });
    await loginAs(page, operator, '/superadmin/panduan');
  });

  test('indeks menampilkan tiga panduan dan menu superadmin', async ({ page, viewport }) => {
    await expect(page.getByRole('heading', { name: 'Panduan sistem SIM RS', level: 1 })).toBeVisible();
    for (const title of ['Cara sistem bekerja', 'Cara kode bekerja', 'Tutorial']) {
      await expect(page.getByRole('link', { name: new RegExp(title) })).toBeVisible();
    }
    if ((viewport?.width ?? 1280) >= 768) {
      const nav = page.getByRole('navigation', { name: 'Navigasi utama' });
      await expect(nav.getByText('SUPERADMIN', { exact: true })).toBeVisible();
      // Operator platform tidak melihat menu klinis RS.
      await expect(nav.getByText('IGD')).toHaveCount(0);
    }
  });

  test('membuka tutorial dan berpindah lewat daftar isi', async ({ page }) => {
    await page.getByRole('link', { name: /Tutorial/ }).click();
    await expect(page).toHaveURL(/\/superadmin\/panduan\/tutorial$/);
    await expect(page.getByRole('heading', { name: 'Tutorial', level: 1 })).toBeVisible();
    const toc = page.getByRole('navigation', { name: 'Daftar isi' });
    await toc.getByRole('link', { name: '8. Pemecahan masalah' }).click();
    await expect(page).toHaveURL(/#8-pemecahan-masalah$/);
    await expect(page.getByRole('heading', { name: '8. Pemecahan masalah' })).toBeInViewport();
  });

  test('tautan antar-panduan memakai rute aplikasi', async ({ page }) => {
    await page.goto('/superadmin/panduan/cara-kerja-sistem');
    await page.getByRole('article').getByRole('link', { name: 'Cara kode bekerja' }).first().click();
    await expect(page).toHaveURL(/\/superadmin\/panduan\/cara-kerja-kode$/);
  });

  test('slug tak dikenal dan upaya path traversal → 404', async ({ page }) => {
    for (const path of ['/superadmin/panduan/tidak-ada', '/superadmin/panduan/..%2F..%2F.env']) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBe(404);
    }
  });

  test('halaman memakai header keamanan', async ({ page }) => {
    const res = await page.goto('/superadmin/panduan/cara-kerja-kode');
    const headers = res?.headers() ?? {};
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-powered-by']).toBeUndefined();
    expect(headers['strict-transport-security']).toContain('max-age=31536000');
  });
});

test.describe('area superadmin tertutup bagi akun RS', () => {
  test('admin RS: panduan dan /dev/ui → 404, menu superadmin tidak ada', async ({ page, viewport }) => {
    const admin = await createAccount({ roles: ['admin_tenant'] });
    await loginAs(page, admin);
    if ((viewport?.width ?? 1280) >= 768) {
      await expect(
        page.getByRole('navigation', { name: 'Navigasi utama' }).getByText('SUPERADMIN', { exact: true }),
      ).toHaveCount(0);
    }
    for (const path of ['/superadmin/panduan', '/superadmin/panduan/tutorial', '/dev/ui']) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBe(404);
      await expect(page.getByText('Cara kode bekerja')).toHaveCount(0);
    }
  });
});
