import { expect, test } from '@playwright/test';
import { createAccount } from '../support/accounts';
import { loginRole, switchRole } from './penunjang-support';
import { ENCOUNTER_ID } from '../../src/lib/demo/fixtures/ids';

test('CPOE → penerimaan spesimen → Gateway → hasil tervalidasi → antrean Integrasi, bertahan lintas posisi', async ({
  page,
}) => {
  const account = await createAccount({
    roles: ['dokter', 'analis_lab', 'admin_tenant'],
    displayName: 'Dokter Aliran Order Fiktif',
  });
  await loginRole(page, account, 'Dokter (DPJP)');
  await page.goto(`/klinis/order/${ENCOUNTER_ID.rohana}`);
  await page.getByLabel('Cari pemeriksaan, obat, tindakan').fill('Glukosa darah sewaktu');
  await page.getByRole('button', { name: /^Tambah Glukosa darah sewaktu/ }).click();
  await page.getByRole('button', { name: /^Tanda tangani dan kirim \d+ order$/ }).click();
  await expect(page.getByText(/order terkirim pukul/)).toBeVisible();
  await switchRole(page, 'Analis laboratorium');
  await page.goto('/penunjang/lab');
  await page
    .getByRole('region', { name: 'Worklist', exact: true })
    .getByRole('button', { name: /Rohana.*Glukosa darah sewaktu/ })
    .click();
  const result = page.getByRole('region', { name: 'Hasil pemeriksaan' });
  await expect(result).toContainText('Pengirim: Dokter Aliran Order Fiktif');
  const no = (await result.textContent())!.match(/L\d{10}/)![0];
  await result.getByLabel('Jenis spesimen yang diterima').fill('Serum');
  await result.getByRole('checkbox', { name: 'Nama, RM, dan label tabung sudah dicocokkan' }).check();
  await result.getByRole('button', { name: 'Terima spesimen' }).click();
  await expect(result).toContainText('sampel diterima');
  const sampleUrl = page.url();
  await page.reload();
  await expect(result).toContainText('sampel diterima');
  await switchRole(page, 'Admin SIM RS');
  await page.goto('/sistem/integrasi/perangkat');
  const form = page.getByRole('form', { name: 'Simulasi pesan masuk' });
  await form
    .getByLabel('Isi pesan HL7 (boleh diubah untuk mencoba galat)')
    .fill(
      `MSH|^~\\&|KIMIA-01|LAB|SIMRS|RSFA|20261006100000||ORU^R01|CX-CPOE-FLOW|P|2.5.1\nPID|||FIKTIF\nOBR|1|${no}||KIMIA\nOBX|1|NM|2345-7^Glukosa sewaktu^LN||125|mg/dL|70-140|N|||F`,
    );
  await form.getByRole('button', { name: 'Kirim ke gateway' }).click();
  await expect(page.getByRole('region', { name: 'Log pesan gateway' })).toContainText('ACK AA');
  await switchRole(page, 'Analis laboratorium');
  await page.goto(sampleUrl);
  await expect(result.getByRole('row', { name: /Glukosa/ })).toContainText('125');
  await result.getByRole('button', { name: 'Validasi teknis' }).click();
  await expect(result).toContainText('Validasi teknis tersimpan');
  await switchRole(page, 'Dokter (DPJP)');
  await page.goto(sampleUrl);
  await result.getByRole('button', { name: 'Validasi klinis (TTE Sp.PK)' }).click();
  await expect(result).toContainText('TTE Dokter Aliran Order Fiktif');
  await switchRole(page, 'Admin SIM RS');
  await page.goto('/sistem/integrasi/satusehat');
  await expect(page.getByText('Ny. Rohana Siregar').first()).toBeVisible();
  await page.reload();
  await expect(page.getByText('Ny. Rohana Siregar').first()).toBeVisible();
  await switchRole(page, 'Dokter (DPJP)');
  await page.goto('/penunjang/farmasi');
  const held = page.getByRole('region', { name: 'Order CPOE menunggu kelengkapan' });
  await expect(held).toContainText('Ny. Rohana Siregar');
  await expect(held).toContainText('jumlah');
});
