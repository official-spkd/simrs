import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { jakartaParts } from '@simrs/shared';
import { createAccount, createBreakGlassGrant, insertAuditEvents, loginAs } from './support/accounts';

function todayWib(): string {
  const p = jakartaParts(new Date());
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

test.describe('layar Audit (/sistem/audit)', () => {
  test('petugas privasi: log, detail entri dengan hash, verifikasi rantai', async ({ page }) => {
    const privasi = await createAccount({ roles: ['petugas_privasi'], displayName: 'Lestari Ayu' });
    await loginAs(page, privasi, '/sistem/audit');
    await expect(page.getByRole('heading', { name: 'Jejak audit', level: 1 })).toBeVisible();
    const log = page.getByRole('region', { name: 'Log aktivitas' });
    await expect(log.getByText('Lestari Ayu').first()).toBeVisible();

    await log.getByRole('row').nth(1).getByRole('link').click();
    await expect(page).toHaveURL(/kejadian=\d+/);
    const detail = page.getByRole('complementary', { name: 'Detail' });
    await expect(detail.getByText(/^Detail aktivitas · entri #\d+$/)).toBeVisible();
    await expect(detail.getByText(/Hash: [0-9a-f]{64}/)).toBeVisible();

    await page.getByRole('link', { name: 'Periksa keutuhan rantai' }).click();
    await expect(page.getByText(/entri diperiksa pukul|Ketidakcocokan hash/)).toBeVisible();
  });

  test('akses darurat: buka dari tautan notifikasi, baca alasan, beri keputusan; tampil di laporan harian', async ({
    page,
  }) => {
    const perawat = await createAccount({ roles: ['perawat'], displayName: 'dr. Nur Fadilah' });
    const reason = `Pasien tidak sadar di IGD, konsul jaga ${perawat.id.slice(-6)}`;
    const grantId = await createBreakGlassGrant(perawat, reason);
    const privasi = await createAccount({ roles: ['petugas_privasi'] });
    await loginAs(page, privasi, `/sistem/audit?tinjau=${grantId}`);

    const detail = page.getByRole('complementary', { name: 'Detail' });
    await expect(detail.getByText('ALASAN AKSES DARURAT (WAJIB)')).toBeVisible();
    await expect(detail.getByText(reason)).toBeVisible();
    await expect(detail.getByText('Belum ditinjau')).toBeVisible();
    await detail.getByLabel('Catatan (opsional)').fill('Sesuai SOP IGD');
    await detail.getByRole('button', { name: 'Ditinjau: akses sah' }).click();
    await expect(detail.getByText(/Ditinjau pukul .* · akses sah/)).toBeVisible();

    const report = page
      .getByRole('heading', { name: 'Laporan harian akses darurat' })
      .locator('xpath=ancestor::section[1]');
    const row = report.getByRole('row').filter({ hasText: reason });
    await expect(row.getByText('akses sah')).toBeVisible();
  });

  test('temuan gagal masuk berulang: tinjau dengan catatan', async ({ page }) => {
    const kasir = await createAccount({ roles: ['kasir'], displayName: 'Hendra Setiawan' });
    await insertAuditEvents(kasir, 'kasir', 'login_failed', 6);
    const privasi = await createAccount({ roles: ['petugas_privasi'] });
    const key = `login_failed:${kasir.id}:${todayWib()}`;
    await loginAs(page, privasi, `/sistem/audit?temuan=${encodeURIComponent(key)}`);

    const detail = page.getByRole('complementary', { name: 'Detail' });
    await expect(detail.getByRole('heading', { name: '6× gagal masuk dalam sehari' })).toBeVisible();
    await expect(detail.getByText(/Hendra Setiawan/).first()).toBeVisible();
    await detail.getByLabel('Catatan (opsional)').fill('Konfirmasi ke kasir: lupa sandi');
    await detail.getByRole('button', { name: 'Ditinjau: perlu klarifikasi' }).click();
    await expect(detail.getByText(/Ditinjau pukul .* · perlu klarifikasi/)).toBeVisible();
    await expect(detail.getByText('Catatan: Konfirmasi ke kasir: lupa sandi')).toBeVisible();
  });

  test('auditor mutu: unduh paket bukti CSV; admin RS tanpa izin ekspor', async ({ page, browser }) => {
    test.setTimeout(60_000); // dua sesi login dalam satu tes
    const auditor = await createAccount({ roles: ['auditor_mutu'] });
    // Disaring ke pengguna ini: jejak bersama RSFA di simrs_test bisa melewati batas ekspor 10.000 entri per hari.
    await loginAs(page, auditor, `/sistem/audit?rentang=hari-ini&pengguna=${auditor.id}`);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('link', { name: 'Unduh paket bukti akreditasi' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^jejak-audit-RSFA-\d{4}-\d{2}-\d{2}\.csv$/);
    const csv = await readFile((await download.path()) as string, 'utf8');
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1).startsWith('"seq","waktu_server"')).toBe(true);
    // Tautan dari situs lain (cookie Lax ikut terkirim) tidak boleh memicu ekspor.
    const crossSite = await page.request.get('/sistem/audit/ekspor?rentang=hari-ini', {
      headers: { 'sec-fetch-site': 'cross-site' },
    });
    expect(crossSite.status()).toBe(403);

    const ctx = await browser.newContext();
    const other = await ctx.newPage();
    const admin = await createAccount({ roles: ['admin_tenant'] });
    await loginAs(other, admin, '/sistem/audit');
    await expect(other.getByRole('heading', { name: 'Jejak audit', level: 1 })).toBeVisible();
    await expect(other.getByRole('link', { name: 'Unduh paket bukti akreditasi' })).toHaveCount(0);
    expect((await other.request.get('/sistem/audit/ekspor?rentang=hari-ini')).status()).toBe(403);
    await ctx.close();
  });

  test('perawat: tanpa izin baca audit', async ({ page }) => {
    const perawat = await createAccount({ roles: ['perawat'] });
    await loginAs(page, perawat, '/sistem/audit');
    await expect(page.getByText('Peran Anda tidak berizin membaca jejak audit.')).toBeVisible();
  });
});
