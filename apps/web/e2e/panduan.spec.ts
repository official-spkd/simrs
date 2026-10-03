import { expect, test } from '@playwright/test';

test.describe('panduan superadmin (APP_ENV=local)', () => {
  test('indeks menampilkan tiga panduan dan menu superadmin', async ({ page, viewport }) => {
    await page.goto('/superadmin/panduan');
    await expect(page.getByRole('heading', { name: 'Panduan sistem SIM RS', level: 1 })).toBeVisible();
    for (const title of ['Cara sistem bekerja', 'Cara kode bekerja', 'Tutorial']) {
      await expect(page.getByRole('link', { name: new RegExp(title) })).toBeVisible();
    }
    if ((viewport?.width ?? 1280) >= 768) {
      await expect(
        page.getByRole('navigation', { name: 'Navigasi utama' }).getByText('SUPERADMIN'),
      ).toBeVisible();
    }
  });

  test('membuka tutorial dan berpindah lewat daftar isi', async ({ page }) => {
    await page.goto('/superadmin/panduan');
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
