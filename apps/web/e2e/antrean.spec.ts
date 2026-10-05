import { expect, test } from '@playwright/test';
import { createPrismaClient } from '@simrs/db';
import { testDbUrls } from '@simrs/db/testing';
import { createAccount, loginAs, TENANTS } from './support/accounts';
import { registerBoundTestDisplay, useDeviceToken } from './support/devices';
import { ensureRsfaSchedule } from './support/schedule';

/**
 * F04 · Kendali antrean + display TV mode api (fase 2 potongan 4b): petugas memanggil dari "Kendali antrean", TV
 * (perangkat display terdaftar, bukan akun staf) menampilkan panggilan itu lewat SSE tanpa dimuat ulang.
 */

/** Token TV uji yang terikat ke papan seed `RJ-LT2` (poli PD/JT/SR/PR), dibuat sekali untuk berkas ini. */
let tvToken = '';

test.beforeAll(async () => {
  await ensureRsfaSchedule();
  const owner = createPrismaClient({ connectionString: testDbUrls().migrator, max: 1 });
  try {
    tvToken = await registerBoundTestDisplay(owner, TENANTS.RSFA, 'RJ-LT2');
  } finally {
    await owner.$disconnect();
  }
});

test.describe('kendali antrean dan display TV', () => {
  test('panggil dari Kendali antrean → TV menampilkan nomor tanpa muat ulang', async ({
    page,
    browser,
  }, info) => {
    test.skip(
      info.project.name !== 'desktop',
      'Satu proyek saja: TV uji dan antrean PD RSFA dipakai bersama.',
    );
    test.setTimeout(90_000);

    // TV: perangkat display terdaftar, tanpa akun staf.
    const tvContext = await browser.newContext();
    await useDeviceToken(tvContext, tvToken);
    const tv = await tvContext.newPage();
    await tv.goto('/display/antrean');
    await expect(tv.getByRole('heading', { level: 1 })).toContainText('Rawat Jalan Lantai 2');
    const tvStatus = tv.getByRole('group', { name: 'Kontrol perangkat' }).getByRole('status');
    await expect(tvStatus).toHaveText('Tersambung');
    await expect(tv.getByRole('button', { name: 'Aktifkan suara' })).toBeVisible();

    // Petugas pendaftaran: layanan Poli PD, ambil nomor lalu panggil berikutnya ke ruangnya.
    const loket = await createAccount({ roles: ['petugas_pendaftaran'] });
    await loginAs(page, loket, '/antrean');
    await expect(page.getByRole('heading', { name: 'Kendali antrean', level: 1 })).toBeVisible();
    await page
      .getByRole('navigation', { name: 'Layanan antrean' })
      .getByRole('link', { name: /^PD/ })
      .click();
    await expect(page.getByRole('link', { name: /^PD/ })).toHaveAttribute('aria-current', 'page');
    const panel = page.getByRole('region', { name: 'Panggilan' });
    await panel.getByRole('button', { name: 'Ambil nomor baru' }).click();
    await expect(panel.getByRole('status')).toContainText(/Nomor PD-\d{3} diterbitkan/);
    const counter = await panel.getByLabel('Loket / ruang pemanggil').inputValue();
    await panel.getByRole('button', { name: /^Panggil berikutnya · PD-\d{3}$/ }).click();
    const status = panel.getByRole('status');
    await expect(status).toContainText(/PD-\d{3} dipanggil ke /);
    const called = /PD-\d{3}/.exec((await status.textContent()) ?? '')?.[0] ?? '';
    expect(called).not.toBe('');
    await expect(status).toContainText(`dipanggil ke ${counter}`);

    // TV berubah lewat SSE (tanpa reload): nomor tampil di panel panggilan (atau riwayatnya bila TV lain memanggil).
    await expect(tv.getByRole('region', { name: 'Sedang dipanggil' })).toContainText(called, {
      timeout: 15_000,
    });
    await expect(tv.getByRole('group', { name: 'Poli Penyakit Dalam' })).toBeVisible();

    // Daftar Kendali: nomor itu kini "Dipanggil" (teks + ikon), dengan aksi lanjutan.
    const row = page.getByRole('listitem', { name: `${called} · Dipanggil` });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: `Mulai layani ${called}` }).click();
    await expect(page.getByRole('listitem', { name: `${called} · Dilayani` })).toBeVisible();
    await page.getByRole('button', { name: `Selesai ${called}` }).click();
    await expect(page.getByRole('listitem', { name: `${called} · Selesai` })).toBeVisible();
    await tvContext.close();
  });

  test('menu dan akses: Kendali antrean butuh `queue.read`', async ({ page }) => {
    const kasir = await createAccount({ roles: ['kasir'] });
    await loginAs(page, kasir, '/antrean');
    await expect(page.getByText('Akses ditolak')).toBeVisible();
    const nav = page.getByRole('navigation', { name: 'Navigasi utama' });
    await expect(nav.getByText('Kendali antrean')).toHaveCount(0);
  });
});
