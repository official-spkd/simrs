import { expect, type Page, test } from '@playwright/test';
import { createAccount, submitPassword, totpFor, typeCode } from '../support/accounts';
import { LAB_SAMPLE_ID } from '../../src/lib/demo/fixtures/ids';

async function login(page: Page, roleName: string) {
  const account = await createAccount({
    roles: ['admin_tenant', 'analis_lab'],
    displayName: 'Petugas Aliran Fiktif',
  });
  await page.goto('/');
  await submitPassword(page, account, account.password);
  await typeCode(page, totpFor(account.totpSecret!));
  await page.getByRole('button', { name: 'Verifikasi dan lanjut' }).click();
  await page.getByText(roleName, { exact: true }).click();
  await page.getByRole('button', { name: `Masuk sebagai ${roleName}` }).click();
}
async function switchRole(page: Page, roleName: string) {
  await page.getByRole('link', { name: 'Ganti posisi' }).first().click();
  await page.getByText(roleName, { exact: true }).click();
  await page.getByRole('button', { name: `Pindah ke ${roleName}` }).click();
  await expect(page.getByText(new RegExp(`Anda masuk sebagai\\s*${roleName}`))).toBeVisible();
}

test('Gateway → hasil Lab bertahan setelah reload/pergantian posisi; reset mengembalikan seluruh domain', async ({
  page,
}) => {
  await login(page, 'Admin SIM RS');
  await page.goto('/sistem/integrasi/perangkat');
  const form = page.getByRole('form', { name: 'Simulasi pesan masuk' });
  await form
    .getByLabel('Isi pesan HL7 (boleh diubah untuk mencoba galat)')
    .fill(
      'MSH|^~\\&|HEMA-01|LAB|SIMRS|RSFA|20261005104400||ORU^R01|CX1-PERSIST|P|2.5.1\nPID|||identitas-uji\nOBR|1|L2610050163||DL\nOBX|1|NM|718-7^Hemoglobin^LN||12.4|g/dL|12.0-15.5|N|||F',
    );
  await form.getByRole('button', { name: 'Kirim ke gateway' }).click();
  const log = page.getByRole('region', { name: 'Log pesan gateway' });
  await expect(log.getByRole('listitem').first()).toContainText('ACK AA');
  await expect(log).not.toContainText('identitas-uji');
  await page.reload();
  await expect(log.getByRole('listitem').first()).toContainText('CX1-PERSIST');
  await switchRole(page, 'Analis laboratorium');
  await page.goto(`/penunjang/lab?pilih=${LAB_SAMPLE_ID.anisa}`);
  const results = page.getByRole('region', { name: 'Hasil pemeriksaan' });
  await expect(results.getByRole('row', { name: /Hemoglobin/ })).toContainText('12,4');
  await results.getByRole('button', { name: 'Validasi teknis' }).click();
  await expect(results).toContainText('oleh Petugas Aliran Fiktif');
  await page.reload();
  await expect(results).toContainText('oleh Petugas Aliran Fiktif');
  await expect(results.getByRole('button', { name: 'Validasi klinis (TTE Sp.PK)' })).toBeDisabled();
  await expect(results).toContainText('wajib posisi Dokter');
  await switchRole(page, 'Admin SIM RS');
  await page.getByRole('button', { name: /Mode presentasi · data fiktif/ }).click();
  const menu = page.getByRole('region', { name: 'Data demo' });
  await menu.getByRole('button', { name: 'Mulai ulang data demo' }).click();
  await menu.getByRole('alertdialog').getByRole('button', { name: 'Ya, mulai ulang' }).click();
  await expect(menu).toContainText('0 aksi tersimpan');
  await page.keyboard.press('Escape');
  await page.goto('/sistem/integrasi/perangkat');
  await expect(page.getByRole('region', { name: 'Log pesan gateway' }).getByRole('listitem')).toHaveCount(0);
});
