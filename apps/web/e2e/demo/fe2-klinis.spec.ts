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
