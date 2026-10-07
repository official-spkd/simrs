import { type Browser, type BrowserContext, expect, type Page, test } from '@playwright/test';
import { type Account, inTenant, loginAs, TENANTS } from './support/accounts';
import { admitPatient, createStaff, createWard } from './support/inpatient';

/**
 * Rantai lintas layar rawat inap mode api (jaring regresi agen BUG): pasien diadmisi lewat API → DPJP membuka rekam
 * di layar Rawat inap (W4) → tautan cepat "Order & resep (CPOE)" → resep injeksi dikirim di CPOE (W2) → perawat bangsal
 * melihat jadwal obat itu di eMAR layar Rawat inap, terkunci sampai gelang dipindai, lalu mencatat pemberiannya
 * setelah gelang dan label obat cocok. Semua layar di rantai ini dijaga tanpa galat konsol/halaman dan tanpa respons 5xx. Data fiktif.
 */

const contexts: BrowserContext[] = [];
const errors: string[] = [];

async function as(browser: Browser, acc: Account, path: string): Promise<Page> {
  const ctx = await browser.newContext();
  contexts.push(ctx);
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${acc.displayName}: ${m.text()} @ ${m.location().url}`);
  });
  page.on('pageerror', (e) => errors.push(`${acc.displayName}: ${e.message}`));
  page.on('response', (r) => {
    if (r.status() >= 500) errors.push(`${acc.displayName}: ${r.status()} ${r.request().method()} ${r.url()}`);
  });
  await loginAs(page, acc, path);
  return page;
}

test.afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.close();
  expect(errors.splice(0)).toEqual([]);
});

test('rantai rawat inap (api): admisi → rekam Rawat inap → CPOE resep → eMAR perawat bangsal', async ({
  browser,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'cukup di proyek desktop (bangsal + akun dibuat per tes)');
  test.setTimeout(150_000);
  const ward = await createWard();
  const dpjp = await createStaff('dokter', ward.unitId, 'dr. DPJP Rantai E2E, Sp.PD');
  const nurse = await createStaff('perawat', ward.unitId, 'Ns. Rantai E2E');
  const p = await admitPatient(ward, dpjp, 'Tn. Rantai Ranap Fiktif');

  // 1) DPJP: daftar Rawat inap → rekam pasien → tautan cepat ke CPOE kunjungan yang sama.
  const doc = await as(browser, dpjp, '/klinis/rawat-inap');
  await doc.getByRole('link', { name: new RegExp(p.patientName) }).click();
  await expect(doc.getByLabel('Identitas pasien')).toContainText(p.mrn);
  await doc
    .getByRole('navigation', { name: 'Tautan cepat pasien' })
    .getByRole('link', { name: 'Order & resep (CPOE)' })
    .click();
  await expect(doc).toHaveURL(new RegExp(`/klinis/order/${p.encounterId}$`));
  await expect(doc.getByLabel('Identitas pasien')).toContainText(p.mrn);

  // 2) CPOE: seftriakson injeksi intravena segera (stat: satu dosis, jadwal tidak bergantung jam uji) → kirim.
  await doc.getByLabel('Cari pemeriksaan, obat, tindakan').fill('seftriakson');
  await doc.getByRole('button', { name: 'Tambah Seftriakson 2 g injeksi' }).click();
  await doc.getByRole('textbox', { name: /^Dosis/ }).fill('2 g');
  await doc.getByRole('combobox', { name: /^Rute/ }).selectOption('intravena');
  await doc.getByRole('combobox', { name: /^Aturan pakai/ }).selectOption('stat');
  const send = doc.getByRole('button', { name: 'Kirim 1 order' });
  await expect(send).toBeEnabled();
  await send.click();
  await expect(doc.getByRole('status').filter({ hasText: '1 order terkirim' })).toBeVisible();
  const request = await inTenant(TENANTS.RSFA, (tx) =>
    tx.medicationRequest.findFirstOrThrow({
      where: { encounterId: p.encounterId },
      select: { id: true, route: true, frequency: true },
    }),
  );
  expect(request).toMatchObject({ route: 'intravena', frequency: 'stat' });

  // 3) Perawat bangsal: eMAR layar Rawat inap menampilkan obat dari CPOE; terkunci sampai gelang cocok.
  const ns = await as(browser, nurse, '/klinis/rawat-inap');
  await ns.getByRole('link', { name: new RegExp(p.patientName) }).click();
  await expect(ns.getByLabel('Identitas pasien')).toContainText(p.mrn);
  await ns.getByRole('tab', { name: 'eMAR' }).click();
  const emar = ns.getByRole('region', { name: 'eMAR' });
  await expect(emar.getByText('Pemberian obat terkunci sampai gelang pasien cocok')).toBeVisible();
  await expect(emar.getByRole('rowheader', { name: /Seftriakson 2 g injeksi 2 g · intravena/ })).toBeVisible();
  const slots = emar.getByRole('button', { name: /^Seftriakson 2 g injeksi/ });
  await expect(slots.first()).toBeVisible();
  await expect(slots.first()).toBeDisabled();
  await emar.getByLabel('Kode gelang pasien').fill(p.wristbandCode);
  await emar.getByRole('button', { name: 'Pindai gelang', exact: true }).click();
  await expect(emar.getByText(/Pasien benar · gelang terpindai/)).toBeVisible();
  await expect(slots.first()).toBeEnabled();
  // Dosis dari order CPOE: pindai label farmasi (= id permintaan obat) → tercatat diberikan.
  await slots.first().click();
  const dose = emar.getByRole('region', { name: /Seftriakson 2 g injeksi · / });
  await dose.getByLabel('Kode label obat (pindai label dari farmasi)').fill(request.id);
  await dose.getByRole('button', { name: 'Catat pemberian' }).click();
  await expect(emar.getByRole('status').filter({ hasText: 'diberikan tercatat' })).toBeVisible();
  const given = await inTenant(TENANTS.RSFA, (tx) =>
    tx.medicationAdministration.findMany({
      where: { encounterId: p.encounterId },
      select: { medicationRequestId: true, status: true, userId: true },
    }),
  );
  expect(given).toEqual([{ medicationRequestId: request.id, status: 'given', userId: nurse.id }]);
});
