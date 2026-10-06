import { expect, type Locator, type Page, test } from '@playwright/test';
import { createAccount, loginAs } from '../support/accounts';

/**
 * FE2 · Layar rekam medis elektronik fase 3 (mode presentasi, ADR-0023): worklist (K01), CPPT + co-sign + serah
 * terima (K07), asesmen (K06), diagnosis (K08), konsultasi (K10), edukasi (K11), askep + gerbang gelang eMAR (K12),
 * ringkasan (K14), paket layanan (K15), kelengkapan rekam medis + gerbang tutup kunjungan (K13).
 */

async function openAs(page: Page, roles: string[], path: string) {
  const account = await createAccount({ roles });
  await loginAs(page, account, path);
  await page.goto(path);
  return account;
}

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

const card = (page: Page, title: RegExp | string): Locator => page.getByRole('article', { name: title });
const JAM = '\\d{2}\\.\\d{2}';

test.describe('K01 · worklist klinis', () => {
  test('DPJP: nilai kritis wajib dibaca ulang; co-sign residen; konsul lewat batas', async ({ page }) => {
    await openAs(page, ['dokter'], '/klinis/worklist');
    await expect(page.getByRole('heading', { level: 1, name: /^Worklist klinis · / })).toBeVisible();
    await expect(page.getByRole('tab', { name: /Tugas tertunda/ })).toHaveAttribute('aria-selected', 'true');

    const kritis = card(page, /Kalium 6,4 mmol\/L \(kritis\)/);
    await expect(kritis.getByText('Kritis', { exact: true })).toBeVisible();
    await kritis.getByRole('button', { name: 'Terima nilai kritis' }).click();
    const save = kritis.getByRole('button', { name: 'Simpan penerimaan' });
    await expect(save).toBeDisabled();
    await kritis.getByLabel('Nilai dibaca ulang (mmol/L)').fill('4,6');
    await kritis.getByLabel('Tindak lanjut').selectOption('Tata laksana sesuai protokol hiperkalemia');
    await save.click();
    await expect(kritis.getByText('Nilai tidak cocok dengan laporan lab.', { exact: false })).toBeVisible();
    await kritis.getByLabel('Nilai dibaca ulang (mmol/L)').fill('6,4');
    await save.click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Diterima dan dibaca ulang: 6,4 mmol/L' }),
    ).toHaveText(
      new RegExp(`tindak lanjut: Tata laksana sesuai protokol hiperkalemia · ${JAM} · Tn\\. Yusuf Hidayat`),
    );
    await expect(card(page, /Kalium 6,4/)).toHaveCount(0);

    const konsul = card(page, /Konsul cito dari dr\. Melati/);
    await expect(konsul.getByText(/^Lewat \d+ mnt$/)).toBeVisible();

    await card(page, /CPPT residen 07\.40/)
      .getByRole('button', { name: 'Co-sign sekarang' })
      .click();
    await expect(page.getByRole('status').filter({ hasText: 'Co-sign DPJP' })).toContainText(
      'Co-sign DPJP · CPPT residen final',
    );
    await page.getByRole('tab', { name: /Selesai/ }).click();
    await expect(page.getByText(new RegExp(`✓ Co-sign DPJP · CPPT residen final · ${JAM}`))).toBeVisible();

    await page.getByRole('tab', { name: /Pasien saya/ }).click();
    const mine = page.getByRole('region', { name: 'Pasien saya' });
    await expect(mine.getByText('Ny. Endang Wijaya', { exact: true })).toBeVisible();
    await expect(mine.getByText('Pulang hari ini')).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test('residen: CPPT menunggu co-sign tidak bisa difinalkan sendiri', async ({ page }) => {
    await openAs(page, ['dokter_residen'], '/klinis/worklist');
    const waiting = card(page, /CPPT Anda 07\.40 menunggu co-sign DPJP/);
    await expect(waiting).toContainText('Residen tidak dapat memfinalkan CPPT sendiri');
    await expect(waiting.getByRole('button')).toHaveCount(0);
    await card(page, /Gula darah sewaktu 236/)
      .getByRole('button', { name: 'Tandai sudah dibaca' })
      .click();
    await expect(page.getByRole('status').filter({ hasText: 'Hasil dibaca' })).toBeVisible();
  });
});

const banner = (page: Page) => page.locator('[aria-label="Identitas pasien"]');
const notes = (page: Page) => page.getByRole('list', { name: 'Catatan CPPT' });
const note = (page: Page, text: string) => notes(page).getByRole('listitem').filter({ hasText: text });

test.describe('K07 · CPPT, co-sign, serah terima', () => {
  test('residen: catatan baru belum final sampai co-sign; singkatan terlarang diperingatkan', async ({
    page,
  }) => {
    await openAs(page, ['dokter_residen'], '/klinis/cppt');
    await expect(
      page.getByRole('heading', { level: 1, name: 'CPPT & serah terima · Ny. Endang Wijaya' }),
    ).toBeVisible();
    await expect(banner(page).getByText('Alergi: Amoksisilin')).toBeVisible();
    await page.getByRole('button', { name: '+ Tulis CPPT (SOAP)' }).click();
    const form = page.getByRole('form', { name: 'Tulis CPPT baru' });
    await expect(form.getByRole('note')).toContainText('Residen tidak dapat memfinalkan catatannya sendiri');
    await form.getByLabel('S · Subjektif').fill('Mual berkurang, nafsu makan membaik.');
    await form.getByLabel('A · Asesmen').fill('Hiperglikemia membaik.');
    await form.getByLabel('P · Rencana').fill('Insulin aspart 6 U sebelum makan siang.');
    await expect(form.getByText('Singkatan terlarang (peringatan, tidak memblokir):')).toBeVisible();
    await form.getByRole('button', { name: 'Simpan dan ajukan co-sign DPJP' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'menunggu co-sign DPJP' })).toHaveText(
      new RegExp(`Tersimpan · ${JAM} · belum final, menunggu co-sign DPJP`),
    );
    const mine = note(page, 'Hiperglikemia membaik.');
    await expect(mine.getByText('Belum final · menunggu co-sign DPJP')).toBeVisible();
    await expect(mine.getByRole('button', { name: 'Co-sign DPJP' })).toBeDisabled();
    await expect(mine.getByText('Hanya DPJP (posisi dokter) yang dapat co-sign.')).toBeVisible();
  });

  test('DPJP: co-sign residen, verifikasi PPA lain, riwayat versi, koreksi beralasan', async ({ page }) => {
    await openAs(page, ['dokter'], '/klinis/cppt');
    const residen = note(page, 'Pneumonia komunitas perbaikan; DM hiperglikemia.');
    await expect(residen.getByText('Belum final · menunggu co-sign DPJP')).toBeVisible();
    await residen.getByRole('button', { name: 'Co-sign DPJP' }).click();
    await expect(residen.getByText(new RegExp(`^Final · co-sign DPJP .+ · ${JAM}$`))).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Co-sign DPJP' })).toContainText('kini final');

    const farmasi = note(page, 'Usul evaluasi de-eskalasi');
    await expect(farmasi.getByText('Final · menunggu verifikasi DPJP (batas 08.15)')).toBeVisible();
    await farmasi.getByRole('button', { name: 'Verifikasi DPJP' }).click();
    await expect(farmasi.getByText(new RegExp(`^Final · diverifikasi DPJP .+ · ${JAM}$`))).toBeVisible();

    const koreksi = note(page, 'SpO2 96% udara bebas, RR 20.');
    await expect(
      koreksi.getByText('Versi 2 · koreksi: Salah ketik nilai SpO2', { exact: false }),
    ).toBeVisible();
    await koreksi.getByRole('button', { name: 'Riwayat versi (2)' }).click();
    await expect(koreksi.getByText(/Versi 1 · .+ · digantikan/)).toBeVisible();

    await page.getByRole('button', { name: '+ Tulis CPPT (SOAP)' }).click();
    const form = page.getByRole('form', { name: 'Tulis CPPT baru' });
    await form.getByLabel('S · Subjektif').fill('Tidak ada keluhan baru.');
    await form.getByLabel('A · Asesmen').fill('Siap pulang hari ini.');
    await form.getByRole('button', { name: 'Simpan dan tanda tangani (final)' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Final · ditandatangani' })).toBeVisible();
    await note(page, 'Siap pulang hari ini.')
      .getByRole('button', { name: /^Koreksi CPPT/ })
      .click();
    const fix = page.getByRole('form', { name: 'Koreksi CPPT' });
    await fix.getByLabel('A · Asesmen').fill('Siap pulang hari ini setelah resume ditandatangani.');
    await fix.getByLabel('Alasan koreksi').fill('kurang');
    await fix.getByRole('button', { name: 'Simpan koreksi (versi baru)' }).click();
    await expect(fix.getByText('Wajib minimal 10 karakter · 4 karakter lagi.')).toBeVisible();
    await fix.getByLabel('Alasan koreksi').fill('Melengkapi syarat pulang');
    await fix.getByRole('button', { name: 'Simpan koreksi (versi baru)' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Koreksi tersimpan' })).toContainText('versi 2');
    await expect(
      note(page, 'setelah resume ditandatangani').getByText('Versi 2 · koreksi: Melengkapi syarat pulang'),
    ).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test('perawat: serah terima SBAR wajib penerima, lalu dikonfirmasi penerima', async ({ page }) => {
    await openAs(page, ['perawat'], '/klinis/cppt');
    const panel = page.getByRole('region', { name: 'Serah terima SBAR' });
    await expect(panel.getByText(/Malam → pagi · diserahkan Ns\. Yudi Pratama/)).toBeVisible();
    await expect(panel.getByText(/^Diterima .+ · 07\.06$/)).toBeVisible();
    await expect(panel.getByLabel('R · Rekomendasi')).not.toBeEmpty();
    await panel.getByRole('button', { name: 'Serahkan shift' }).click();
    await expect(panel.getByRole('alert')).toHaveText('Pilih perawat penerima shift berikutnya.');
    await panel.getByLabel('Penerima shift berikutnya').selectOption('Ns. Rosa Elvira, S.Kep');
    await panel.getByRole('button', { name: 'Serahkan shift' }).click();
    await expect(
      panel.getByText('Menunggu konfirmasi Ns. Rosa Elvira, S.Kep', { exact: true }),
    ).toBeVisible();
    await panel.getByRole('button', { name: 'Konfirmasi penerimaan (simulasi penerima)' }).click();
    await expect(panel.getByText(new RegExp(`^Diterima Ns\\. Rosa Elvira, S\\.Kep · ${JAM}$`))).toBeVisible();
  });
});
