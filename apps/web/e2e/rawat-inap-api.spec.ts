import { type Browser, type BrowserContext, expect, type Page, test } from '@playwright/test';
import { type Account, inTenant, loginAs, TENANTS } from './support/accounts';
import {
  admitPatient,
  createStaff,
  createWard,
  ewsNotifications,
  medicationBillables,
  orderMedication,
  type Inpatient,
} from './support/inpatient';

/**
 * K04/K07/K12 · Layar Rawat inap mode api (fase 3 layar W4). Tiap tes punya bangsal fiktif sendiri; pasien diadmisi
 * lewat API sungguhan. Alur wajib W4:
 * - perawat mencatat TTV abnormal → eskalasi tampil di layarnya, DPJP mendapat notifikasi tanpa PHI dan peringatan
 *   langsung (SSE `ews`) di daftar pasiennya;
 * - eMAR: gelang belum dipindai / pindai salah → pemberian terkunci (pindaian salah tercatat); gelang benar → dosis
 *   tercatat dan biaya obat di-staging (`billable_events`);
 * - residen menulis CPPT → menunggu co-sign → DPJP co-sign.
 * Plus cek ganda obat kewaspadaan tinggi dari sesi perawat kedua. Data fiktif.
 */

const contexts: BrowserContext[] = [];
/** Galat konsol/halaman per tes (layar mode api tidak boleh menghasilkan galat konsol). */
const consoleErrors: string[] = [];

async function as(browser: Browser, acc: Account, path: string): Promise<Page> {
  const ctx = await browser.newContext();
  contexts.push(ctx);
  const page = await ctx.newPage();
  page.on('console', (m) => {
    // favicon.ico belum ada di seluruh aplikasi web (bukan layar ini; dilaporkan ke agen BUG).
    if (m.type() === 'error' && !m.location().url.endsWith('/favicon.ico')) {
      consoleErrors.push(`${acc.displayName}: ${m.text()} @ ${m.location().url}`);
    }
  });
  page.on('pageerror', (e) => consoleErrors.push(`${acc.displayName}: ${e.message}`));
  await loginAs(page, acc, path);
  return page;
}

test.afterEach(async () => {
  const errors = consoleErrors.splice(0);
  for (const ctx of contexts.splice(0)) await ctx.close();
  expect(errors).toEqual([]);
});

async function openRecord(page: Page, p: Inpatient, tab?: string) {
  await page.goto('/klinis/rawat-inap');
  await page.getByRole('link', { name: new RegExp(p.patientName) }).click();
  await expect(page.getByRole('heading', { level: 1, name: /Rawat inap · Bangsal E2E/ })).toBeVisible();
  await expect(page.getByLabel('Identitas pasien')).toContainText(p.mrn);
  if (tab) await page.getByRole('tab', { name: tab }).click();
}

test.describe('Rawat inap mode api (W4)', () => {
  test('perawat mencatat TTV abnormal → eskalasi di layar, notifikasi DPJP, dan peringatan langsung', async ({
    browser,
  }) => {
    const ward = await createWard();
    const dpjp = await createStaff('dokter', ward.unitId, 'dr. DPJP Rawat Inap E2E, Sp.PD');
    const nurse = await createStaff('perawat', ward.unitId, 'Ns. Perawat Rawat Inap E2E');
    const p = await admitPatient(ward, dpjp, 'Tn. Eskalasi EWS Fiktif');

    // DPJP memantau daftar pasiennya (SSE eskalasi EWS lewat BFF).
    const doctor = await as(browser, dpjp, '/klinis/rawat-inap');
    await expect(doctor.getByRole('heading', { name: 'Pasien rawat inap', level: 1 })).toBeVisible();
    await expect(doctor.getByRole('link', { name: new RegExp(p.patientName) })).toBeVisible();
    await expect(doctor.getByText('Pemantauan EWS langsung aktif')).toBeVisible({ timeout: 20_000 });

    const page = await as(browser, nurse, '/klinis/rawat-inap');
    await openRecord(page, p, 'Observasi & EWS');
    const form = page.getByRole('form', { name: 'Catat observasi' });
    await form.getByLabel('Suhu (°C)').fill('39,4');
    await form.getByLabel('Nadi (x/mnt)').fill('132');
    await form.getByLabel('Napas (x/mnt)').fill('27');
    await form.getByLabel('TD sistolik (mmHg)').fill('88');
    await form.getByLabel('TD diastolik (mmHg)').fill('50');
    await form.getByLabel('SpO2 (%)').fill('90');
    await form.getByLabel('Kesadaran (ACVPU)').selectOption('V');
    await expect(form.getByText(/Pratinjau EWS \d+ · tinggi/)).toBeVisible();
    await form.getByRole('button', { name: 'Simpan observasi' }).click();
    await expect(form.getByRole('alert')).toContainText(/Eskalasi EWS: skor \d+ \(risiko tinggi\)/);
    await expect(form.getByRole('alert')).toContainText('Notifikasi terkirim ke DPJP');
    // Tabel observasi dari server memuat baris baru dengan skor tinggi.
    await expect(page.getByRole('table', { name: 'Observasi tanda vital dan skor EWS' })).toContainText(
      'tinggi',
    );

    // DPJP: peringatan langsung di daftar (nama dari daftar yang lolos ABAC, bukan dari muatan SSE) + notifikasi.
    const live = doctor.getByRole('region', { name: 'Eskalasi EWS langsung' }).getByRole('alert');
    await expect(live).toContainText('Eskalasi EWS', { timeout: 20_000 });
    await expect(live).toContainText(p.patientName);
    await live.getByRole('link', { name: 'Buka rekam pasien' }).click();
    await expect(doctor.getByRole('tab', { name: 'Observasi & EWS', selected: true })).toBeVisible();
    const notes = await ewsNotifications(dpjp.id);
    expect(notes.length).toBe(1);
    expect(notes[0]?.link).toBe(`/klinis/rawat-inap?kunjungan=${p.encounterId}`);
    expect(`${notes[0]?.title} ${notes[0]?.body}`).not.toContain(p.patientName);
    // Daftar perawat menandai pasien ini untuk eskalasi.
    await page.goto('/klinis/rawat-inap');
    await expect(page.getByRole('link', { name: new RegExp(p.patientName) })).toContainText('Eskalasi EWS');
  });

  test('eMAR: tanpa pindai gelang terkunci, gelang salah ditolak, gelang benar → dosis tercatat dan biaya di-staging', async ({
    browser,
  }) => {
    const ward = await createWard();
    const dpjp = await createStaff('dokter', ward.unitId, 'dr. DPJP eMAR E2E, Sp.PD');
    const nurse = await createStaff('perawat', ward.unitId, 'Ns. eMAR E2E');
    const p = await admitPatient(ward, dpjp, 'Tn. Gelang eMAR Fiktif');
    const med = await orderMedication(p, dpjp, { drug: 'Seftriakson 2 g injeksi', inMinutes: 2 });
    const slotTime = med.time as string;

    const page = await as(browser, nurse, '/klinis/rawat-inap');
    await openRecord(page, p, 'eMAR');
    const emar = page.getByRole('region', { name: 'eMAR' });
    await expect(emar.getByText('Pemberian obat terkunci sampai gelang pasien cocok')).toBeVisible();
    const slot = emar.getByRole('button', {
      name: new RegExp(`Seftriakson 2 g injeksi jam ${slotTime} · Jadwal`),
    });
    await expect(slot).toBeDisabled();
    await expect(slot).toHaveAccessibleName(/pindai gelang dulu/);

    // Gelang salah: ditolak server, tercatat + diaudit, pemberian tetap terkunci.
    await emar.getByLabel('Kode gelang pasien').fill('GLSALAH0000');
    await emar.getByRole('button', { name: 'Pindai gelang', exact: true }).click();
    await expect(emar.getByRole('alert').filter({ hasText: 'Gelang tidak cocok' })).toBeVisible();
    await expect(slot).toBeDisabled();
    const scans = await inTenant(TENANTS.RSFA, (tx) =>
      tx.wristbandScan.findMany({ where: { encounterId: p.encounterId }, select: { matched: true } }),
    );
    expect(scans).toEqual([{ matched: false }]);

    // Gelang benar → grid terbuka; satu dosis: pindai label → catat.
    await emar.getByLabel('Kode gelang pasien').fill(p.wristbandCode);
    await emar.getByRole('button', { name: 'Pindai gelang', exact: true }).click();
    await expect(emar.getByText(/Pasien benar · gelang terpindai/)).toBeVisible();
    await expect(slot).toBeEnabled();
    await slot.click();
    const dose = emar.getByRole('region', { name: /Seftriakson 2 g injeksi · jadwal/ });
    await expect(dose.getByRole('button', { name: 'Catat pemberian' })).toBeDisabled();
    await dose.getByLabel('Kode label obat (pindai label dari farmasi)').fill(med.medicationRequestId);
    await dose.getByRole('button', { name: 'Catat pemberian' }).click();
    await expect(emar.getByRole('status').filter({ hasText: 'diberikan tercatat' })).toBeVisible();
    await expect(emar.getByRole('list', { name: 'Pemberian tercatat' })).toContainText(
      'Seftriakson 2 g injeksi',
    );
    await expect(
      emar.getByRole('button', { name: new RegExp(`Seftriakson 2 g injeksi jam ${slotTime}.*Diberikan`) }),
    ).toBeVisible();

    const billables = await medicationBillables(p.encounterId);
    expect(billables).toHaveLength(1);
    const given = await inTenant(TENANTS.RSFA, (tx) =>
      tx.medicationAdministration.findMany({
        where: { encounterId: p.encounterId },
        select: { id: true, status: true },
      }),
    );
    expect(given).toEqual([{ id: billables[0]?.sourceId, status: 'given' }]);
  });

  test('residen menulis CPPT → menunggu co-sign → DPJP co-sign', async ({ browser }) => {
    const ward = await createWard();
    const dpjp = await createStaff('dokter', ward.unitId, 'dr. DPJP Co-sign E2E, Sp.PD');
    const residen = await createStaff('dokter_residen', ward.unitId, 'dr. Residen Ranap E2E');
    const p = await admitPatient(ward, dpjp, 'Ny. CPPT Residen Fiktif');

    const page = await as(browser, residen, '/klinis/rawat-inap');
    await openRecord(page, p);
    // Status resume (3.6) dan persetujuan (3.7) tampil sebagai tautan; layarnya milik W5b/W5a.
    const quick = page.getByRole('navigation', { name: 'Tautan cepat pasien' });
    await expect(quick.getByRole('link', { name: 'Resume medis · belum dibuat' })).toBeVisible();
    await expect(quick.getByRole('link', { name: 'Persetujuan tindakan · 0 dokumen' })).toBeVisible();
    const cppt = page.getByRole('region', { name: 'CPPT terintegrasi' });
    await cppt.getByRole('button', { name: '+ Tulis CPPT (SOAP)' }).click();
    const form = page.getByRole('form', { name: 'Tulis CPPT baru' });
    await form.getByLabel('S · Subjektif').fill('Sesak berkurang, batuk masih ada');
    await form.getByLabel('O · Objektif').fill('RR 22, SpO2 95% udara bebas');
    await form.getByLabel('A · Asesmen').fill('Pneumonia komunitas, perbaikan klinis');
    await form.getByLabel('P · Rencana').fill('Lanjut antibiotik IV, evaluasi besok');
    await form.getByRole('button', { name: 'Simpan dan tanda tangani' }).click();
    await expect(cppt.getByRole('status')).toContainText('menunggu co-sign DPJP');
    const note = cppt.getByRole('listitem').filter({ hasText: 'Sesak berkurang' });
    await expect(note).toContainText('Menunggu co-sign DPJP');
    await expect(note.getByRole('button', { name: 'Setujui co-sign DPJP' })).toBeDisabled();
    await expect(note).toContainText('Hanya DPJP (posisi dokter) yang dapat co-sign.');

    const doctor = await as(browser, dpjp, '/klinis/rawat-inap');
    await expect(doctor.getByRole('link', { name: new RegExp(p.patientName) })).toContainText(
      'Co-sign DPJP (1)',
    );
    await openRecord(doctor, p);
    const dnote = doctor
      .getByRole('region', { name: 'CPPT terintegrasi' })
      .getByRole('listitem')
      .filter({ hasText: 'Sesak berkurang' });
    await dnote.getByRole('button', { name: 'Setujui co-sign DPJP' }).click();
    await expect(doctor.getByRole('region', { name: 'CPPT terintegrasi' }).getByRole('status')).toContainText(
      'disetujui DPJP',
    );
    await expect(dnote).toContainText(`Co-sign DPJP ${dpjp.displayName}`);
    await expect(dnote.getByRole('button', { name: 'Setujui co-sign DPJP' })).toHaveCount(0);

    // Residen melihat catatannya sudah final setelah co-sign.
    await page.reload();
    await expect(
      page
        .getByRole('region', { name: 'CPPT terintegrasi' })
        .getByRole('listitem')
        .filter({ hasText: 'Sesak berkurang' }),
    ).toContainText(`Co-sign DPJP ${dpjp.displayName}`);
  });

  test('obat kewaspadaan tinggi: tanpa cek ganda tidak bisa dicatat; perawat kedua memeriksa dari sesinya sendiri', async ({
    browser,
  }) => {
    test.skip(test.info().project.name !== 'desktop', 'Alur dua perawat cukup sekali (proyek desktop).');
    const ward = await createWard();
    const dpjp = await createStaff('dokter', ward.unitId, 'dr. DPJP High Alert E2E, Sp.PD');
    const nurse = await createStaff('perawat', ward.unitId, 'Ns. Pemberi Obat E2E');
    const second = await createStaff('perawat', ward.unitId, 'Ns. Pemeriksa Kedua E2E');
    const p = await admitPatient(ward, dpjp, 'Tn. Insulin Fiktif');
    const med = await orderMedication(p, dpjp, {
      drug: 'Enoksaparin 60 mg/0,6 mL injeksi',
      highAlert: true,
      frequency: 'stat',
    });

    const page = await as(browser, nurse, '/klinis/rawat-inap');
    await openRecord(page, p, 'eMAR');
    const emar = page.getByRole('region', { name: 'eMAR' });
    await emar.getByLabel('Kode gelang pasien').fill(p.wristbandCode);
    await emar.getByRole('button', { name: 'Pindai gelang', exact: true }).click();
    await emar.getByRole('button', { name: /Enoksaparin .*Stat/ }).click();
    const dose = emar.getByRole('region', { name: /Enoksaparin .*Stat/ });
    await dose.getByLabel('Kode label obat (pindai label dari farmasi)').fill(med.medicationRequestId);
    await expect(dose.getByText('Menunggu cek ganda perawat kedua.')).toBeVisible();
    await expect(dose.getByRole('button', { name: 'Catat pemberian' })).toBeDisabled();

    // Perawat kedua, sesinya sendiri: memilih pindaian rekan dan dosis, memindai label, mencatat cek ganda.
    const checker = await as(browser, second, '/klinis/rawat-inap');
    await openRecord(checker, p, 'eMAR');
    const peer = checker.getByRole('form', { name: 'Cek ganda untuk rekan' });
    await expect(peer.getByLabel('Pindaian gelang rekan')).toContainText(nurse.displayName);
    await peer.getByLabel('Kode label obat (pindai)').fill(med.medicationRequestId);
    await peer.getByRole('button', { name: 'Catat cek ganda' }).click();
    await expect(checker.getByRole('status').filter({ hasText: 'Cek ganda tercatat' })).toBeVisible();

    await dose.getByRole('button', { name: 'Periksa cek ganda' }).click();
    await expect(dose.getByText(`✓ Cek ganda oleh ${second.displayName}`)).toBeVisible();
    await dose.getByRole('button', { name: 'Catat pemberian' }).click();
    await expect(
      emar.getByRole('status').filter({ hasText: `cek ganda ${second.displayName}` }),
    ).toBeVisible();
    const rows = await inTenant(TENANTS.RSFA, (tx) =>
      tx.medicationAdministration.findMany({
        where: { encounterId: p.encounterId },
        select: { doubleCheckUserId: true, status: true },
      }),
    );
    expect(rows).toEqual([{ doubleCheckUserId: second.id, status: 'given' }]);
  });
});
