import { expect, type Page, test } from '@playwright/test';
import { createAccount, loginAs } from './support/accounts';
import { E2E_DEMO_PORT, E2E_WEB_PORT } from './support/slot';

/**
 * Header keamanan web di build produksi (`next build && next start`, ADR-0073): CSP ber-nonce per permintaan tanpa
 * skrip `unsafe-inline`/`unsafe-eval`, semua skrip Next membawa nonce, dan halaman tetap terhidrasi (kolom kode
 * MFA berpindah fokus lewat JavaScript; tanpa hidrasi login tidak selesai).
 */

/** Pelanggaran CSP yang dilaporkan peramban (event + konsol), dikumpulkan sejak halaman pertama. */
async function watchCsp(page: Page): Promise<() => Promise<string[]>> {
  const logged: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && /Content Security Policy/i.test(m.text())) logged.push(m.text());
  });
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      const w = window as unknown as { __csp?: string[] };
      (w.__csp ??= []).push(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  return async () => [
    ...logged,
    ...(await page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? [])),
  ];
}

const directive = (csp: string, name: string) => csp.split('; ').find((d) => d.startsWith(`${name} `)) ?? '';
const nonceOf = (csp: string) => /'nonce-([A-Za-z0-9+/=]+)'/.exec(csp)?.[1] ?? '';

test.describe('header keamanan web (produksi)', () => {
  test('CSP ber-nonce tanpa skrip inline; header keamanan lengkap', async ({ page }) => {
    const res = await page.goto('/masuk');
    const h = res?.headers() ?? {};
    const csp = h['content-security-policy'] ?? '';
    expect(directive(csp, 'script-src')).toMatch(
      /^script-src 'self' 'nonce-[A-Za-z0-9+/=]{24}' 'strict-dynamic'$/,
    );
    expect(csp).not.toContain('unsafe-eval');
    expect(directive(csp, 'script-src')).not.toContain('unsafe-inline');
    for (const d of [
      "default-src 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ]) {
      expect(csp).toContain(d);
    }
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['x-frame-options']).toBe('DENY');
    expect(h['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(h['cross-origin-opener-policy']).toBe('same-origin');
    expect(h['permissions-policy']).toContain('camera=()');
    expect(h['strict-transport-security']).toContain('max-age=31536000');
    expect(h['x-powered-by']).toBeUndefined();

    // Semua skrip halaman (kerangka Next + data RSC) membawa nonce permintaan ini.
    const nonce = nonceOf(csp);
    const scripts = await page.evaluate(() => [...document.scripts].map((s) => s.nonce));
    expect(scripts.length).toBeGreaterThan(0);
    expect(scripts.every((n) => n === nonce)).toBe(true);

    // Nonce baru untuk setiap permintaan.
    const again = await page.request.get('/masuk');
    const next = nonceOf(again.headers()['content-security-policy'] ?? '');
    expect(next).not.toBe('');
    expect(next).not.toBe(nonce);
  });

  test('CSP ber-nonce + header keamanan di semua jenis rute (publik, 404, path berakhiran ekstensi)', async ({
    request,
  }) => {
    for (const path of [
      '/masuk',
      '/perangkat/daftar',
      '/verifikasi/sv1.bukan-kode',
      '/verifikasi/kode.png',
      '/tidak-ada.png',
      '/tidak-ada',
      '/pasien',
    ]) {
      const res = await request.get(path, { maxRedirects: 0 });
      const h = res.headers();
      expect(nonceOf(h['content-security-policy'] ?? ''), path).not.toBe('');
      expect(h['content-security-policy'], path).toContain("frame-ancestors 'none'");
      expect(h['x-frame-options'], path).toBe('DENY');
      expect(h['x-content-type-options'], path).toBe('nosniff');
    }
  });

  test('login lengkap (sandi → kode MFA) berjalan di bawah CSP tanpa pelanggaran', async ({ page }) => {
    const violations = await watchCsp(page);
    const account = await createAccount({ roles: ['perawat'] });
    await loginAs(page, account);
    await expect(page.getByRole('heading', { name: 'Beranda', level: 1 })).toBeVisible();
    const res = await page.reload();
    expect(directive(res?.headers()['content-security-policy'] ?? '', 'script-src')).toContain(
      'strict-dynamic',
    );
    expect(await violations()).toEqual([]);
  });

  test('dua instans web berbagi satu refresh (Redis): permintaan paralel tidak mencabut sesi', async ({
    page,
    context,
  }) => {
    const account = await createAccount({ roles: ['perawat'] });
    await loginAs(page, account);
    const before = (await context.cookies()).find((c) => c.name === 'simrs_rt')?.value;
    expect(before).toBeTruthy();
    // Cookie akses kedaluwarsa: setiap permintaan berikut membawa refresh token LAMA yang sama.
    await context.clearCookies({ name: 'simrs_at' });

    // Server E2E web (data API) dan mode presentasi = dua instans build yang sama; cookie localhost berlaku di
    // kedua port. Tanpa peta bersama keduanya memanggil /auth/refresh → deteksi pemakaian ulang → sesi dicabut.
    const origins = [`http://localhost:${E2E_WEB_PORT}`, `http://localhost:${E2E_DEMO_PORT}`];
    const responses = await Promise.all(
      origins.flatMap((o) => [1, 2, 3].map(() => context.request.get(`${o}/`, { maxRedirects: 0 }))),
    );
    const rotated = new Set<string>();
    for (const r of responses) {
      expect(r.status(), `${r.url()} tidak dialihkan ke /masuk`).toBe(200);
      const setCookie = r.headersArray().filter((h) => h.name.toLowerCase() === 'set-cookie');
      const rt = setCookie.map((h) => /^simrs_rt=([^;]+)/.exec(h.value)?.[1]).find(Boolean);
      expect(rt, `${r.url()} memperbarui cookie refresh`).toBeTruthy();
      if (rt) rotated.add(decodeURIComponent(rt));
    }
    // Satu rotasi untuk semua instans, dan sesinya tetap hidup.
    expect(rotated.size).toBe(1);
    expect(rotated.has(before ?? '')).toBe(false);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Beranda', level: 1 })).toBeVisible();
  });
});
