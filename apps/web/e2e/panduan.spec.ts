import { expect, test } from '@playwright/test';
import { createAccount, loginAs } from './support/accounts';

test.describe('panduan superadmin (peran superadmin_platform)', () => {
  test.beforeEach(async ({ page }) => {
    const operator = await createAccount({ tenant: 'PLATFORM', roles: ['superadmin_platform'] });
    await loginAs(page, operator, '/superadmin/panduan');
  });

  test('indeks menampilkan panduan sistem dan panduan fitur, serta menu superadmin', async ({
    page,
    viewport,
  }) => {
    await expect(page.getByRole('heading', { name: 'Panduan sistem SIM RS', level: 1 })).toBeVisible();
    const sistem = page.getByRole('region', { name: 'Cara kerja dan operasional' });
    for (const title of ['Cara sistem bekerja', 'Cara kode bekerja', 'Tutorial', 'Peta kode']) {
      await expect(sistem.getByRole('link', { name: new RegExp(title) })).toBeVisible();
    }
    const fitur = page.getByRole('region', { name: 'Panduan fitur per layar' });
    for (const title of ['Fitur platform', 'Fitur klinis', 'Fitur keuangan', 'Simulasi dan operasional']) {
      await expect(fitur.getByRole('link', { name: new RegExp(title) })).toBeVisible();
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

  test('panduan fitur menampilkan tangkapan layar dan diagram dari rute gambar', async ({ page }) => {
    await page.goto('/superadmin/panduan/fitur-klinis');
    await expect(page.getByRole('heading', { name: 'Fitur klinis (RME)', level: 1 })).toBeVisible();
    const article = page.getByRole('article');
    const shot = article.locator('img[src="/superadmin/panduan/gambar/poli.png"]');
    await expect(shot).toHaveAttribute('alt', /.{10,}/);
    await shot.scrollIntoViewIfNeeded();
    await expect.poll(() => shot.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1366);
    const diagram = article.locator('img[src$=".svg"]').first();
    await diagram.scrollIntoViewIfNeeded();
    await expect.poll(() => diagram.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    // Tautan gambar membuka ukuran penuh di rute yang sama.
    await expect(article.getByRole('link', { name: (await shot.getAttribute('alt')) ?? '' })).toHaveAttribute(
      'href',
      '/superadmin/panduan/gambar/poli.png',
    );
  });

  test('rute gambar: jenis konten benar + nosniff; nama tidak sah → 404', async ({ page }) => {
    const png = await page.request.get('/superadmin/panduan/gambar/poli.png');
    expect(png.status()).toBe(200);
    expect(png.headers()['content-type']).toBe('image/png');
    expect(png.headers()['x-content-type-options']).toBe('nosniff');
    const svg = await page.request.get('/superadmin/panduan/gambar/diagram-outbox.svg');
    expect(svg.status()).toBe(200);
    expect(svg.headers()['content-type']).toBe('image/svg+xml');
    expect(svg.headers()['x-content-type-options']).toBe('nosniff');
    expect(svg.headers()['content-security-policy']).toContain('sandbox');
    for (const name of [
      'tidak-ada.png',
      '..%2F02-cara-kerja-kode.md',
      '..%2F..%2F..%2F.env',
      '%2E%2E%2F.env',
      'POLI.png',
      'poli.png.html',
    ]) {
      const res = await page.request.get(`/superadmin/panduan/gambar/${name}`);
      expect(res.status(), name).toBe(404);
    }
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
    for (const path of [
      '/superadmin/panduan',
      '/superadmin/panduan/tutorial',
      '/superadmin/panduan/gambar/poli.png',
      '/dev/ui',
    ]) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBe(404);
      await expect(page.getByText('Cara kode bekerja')).toHaveCount(0);
    }
  });
});
