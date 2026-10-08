import { type Browser, type BrowserContext, expect, type Page, test } from '@playwright/test';
import { newId } from '@simrs/shared';
import { type Account, inTenant, loginAs, TENANTS } from './support/accounts';
import { admitPatient, createStaff, createWard, type Inpatient } from './support/inpatient';

/**
 * S06 · Kamar operasi mode api (fase 4 potongan 4.7, DoD "time out dan insisi"): perawat OK menjadwalkan operasi dari
 * kunjungan rawat inap, daftar tilik WHO (butir persetujuan diisi sistem dari persetujuan tindakan 3.7), konfirmasi
 * time out nonaktif sampai semua butir, insisi terkunci sebelum time out, hitung kasa selisih menahan sign out sampai
 * ditindaklanjuti, laporan operasi ber-TTE operator, pasien keluar → selesai. Override insisi oleh dokter beralasan
 * tercatat. 4.7b: sign in menunggu asesmen pra-anestesi final (formulir P07 diisi dokter), jendela lain terbarui lewat
 * SSE aktivitas, adendum laporan, dan spesimen PA terstruktur. Tanggal jadwal acak di masa depan agar run berulang
 * tidak bertumpang tindih. Data fiktif.
 */

const RSFA = TENANTS.RSFA;
const contexts: BrowserContext[] = [];
const consoleErrors: string[] = [];

async function as(browser: Browser, acc: Account, path: string): Promise<Page> {
  const ctx = await browser.newContext();
  contexts.push(ctx);
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error' && !`${m.text()} ${m.location().url}`.includes('favicon')) {
      consoleErrors.push(`${acc.displayName}: ${m.text()}`);
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

/** Tanggal acak 2033 (jadwal kamar tidak bertumpang tindih antar-run). */
function randomDate(): string {
  const d = new Date(Date.UTC(2033, 0, 1) + Math.floor(Math.random() * 360) * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/** Persetujuan tindakan final `setuju` (alur tablet diuji spesifikasi persetujuan; di sini cukup barisnya). */
async function signedConsent(p: Inpatient, doctor: Account): Promise<void> {
  await inTenant(RSFA, async (tx) => {
    const id = newId();
    await tx.consent.create({
      data: {
        id,
        rootId: id,
        tenantId: RSFA,
        patientId: p.patientId,
        encounterId: p.encounterId,
        occurredAt: new Date(),
        authorUserId: doctor.id,
        authorRole: 'dokter',
        procedure: 'Kolesistektomi laparoskopik',
        decision: 'setuju',
        information: Array.from({ length: 7 }, (_, i) => ({ item: i + 1, explained: true })),
        informerUserId: doctor.id,
        explainedAt: new Date(),
      },
    });
  });
}

/** Asesmen pra-anestesi final (formulir P07 pustaka, 4.7b) lewat DB untuk tes yang tidak menguji pengisiannya. */
async function preAnesthesiaDb(p: Inpatient, doctor: Account): Promise<void> {
  await inTenant(RSFA, async (tx) => {
    const def = await tx.formDefinition.findFirstOrThrow({
      where: { code: 'asesmen_pra_anestesi', status: 'published' },
    });
    const id = newId();
    await tx.formResponse.create({
      data: {
        id,
        rootId: id,
        tenantId: RSFA,
        patientId: p.patientId,
        encounterId: p.encounterId,
        definitionId: def.id,
        formCode: 'asesmen_pra_anestesi',
        answers: {
          asa: 'asa_3',
          darurat: 'ya',
          mallampati: 'm2',
          teknik: 'umum',
          rencana: 'Anestesi umum, ICU pascaoperasi bila perlu',
          persetujuan_anestesi: 'ya',
        },
        createdBy: doctor.id,
      },
    });
  });
}

async function okUnitId(): Promise<string> {
  return inTenant(RSFA, async (tx) => (await tx.unit.findFirstOrThrow({ where: { code: 'OK' } })).id);
}

async function setup(tag: string) {
  const ward = await createWard();
  const okUnit = await okUnitId();
  const dokter = await createStaff('dokter', okUnit, `dr. Operator ${tag} E2E Fiktif, Sp.B`);
  const perawat = await createStaff('perawat', okUnit, `Ns. OK ${tag} E2E Fiktif`);
  const patient = await admitPatient(ward, dokter, `Ratna ${tag} Fiktif Operasi`);
  await signedConsent(patient, dokter);
  return { dokter, perawat, patient };
}

async function schedule(
  page: Page,
  p: Inpatient,
  dokter: Account,
  date: string,
  room: string,
  start: string,
) {
  await page.getByRole('button', { name: '+ Jadwalkan operasi' }).click();
  const form = page.getByRole('region', { name: 'Jadwalkan operasi' });
  await form.getByLabel('No. RM atau nomor kunjungan aktif').fill(p.mrn);
  await form.getByRole('button', { name: 'Cari kunjungan' }).click();
  await form.getByRole('radio', { name: new RegExp(p.patientName) }).check();
  await form.getByLabel('Kamar').selectOption({ label: room });
  await form.getByLabel('Tanggal operasi').fill(date);
  await form.getByLabel('Jam mulai (WIB, HH.MM)').fill(start);
  await form.getByLabel('Durasi (menit)').fill('120');
  await form.getByLabel('Kode ICD-9-CM (opsional)').fill('51.23');
  await form.getByLabel('Nama tindakan').fill('Kolesistektomi laparoskopik');
  await form
    .getByRole('combobox', { name: 'Operator', exact: true })
    .selectOption({ label: dokter.displayName });
  await form.getByRole('button', { name: 'Simpan jadwal' }).click();
  await expect(page.getByText(/Operasi OK-\d{4}-\d{4} dijadwalkan/)).toBeVisible();
}

async function checkPhase(page: Page, phase: 'sign-in' | 'time-out' | 'sign-out', count?: number) {
  // Tunggu daftar tilik fase ini siap diisi (papan dimuat ulang setelah aksi sebelumnya).
  await expect(page.locator(`input[data-phase="${phase}"]:not(:disabled)`).first()).toBeVisible();
  const codes = await page
    .locator(`input[data-phase="${phase}"]:not(:checked):not(:disabled)`)
    .evaluateAll((els) => els.map((e) => (e as HTMLInputElement).dataset.item ?? ''));
  for (const code of codes.slice(0, count ?? codes.length)) {
    const box = page.locator(`input[data-phase="${phase}"][data-item="${code}"]`);
    await box.click();
    await expect(box).toBeChecked();
  }
}

test.describe('Kamar operasi mode api (4.7)', () => {
  test('jadwal → sign in → time out (insisi terkunci) → hitung selisih → sign out → laporan TTE → selesai', async ({
    browser,
  }) => {
    test.setTimeout(150_000);
    const tag = newId().slice(-4).toUpperCase();
    const { dokter, perawat, patient } = await setup(tag);
    const date = randomDate();
    const nurse = await as(browser, perawat, `/penunjang/kamar-operasi?tanggal=${date}`);
    await expect(
      nurse.getByRole('heading', { name: /Kamar operasi · jadwal dan keselamatan/ }),
    ).toBeVisible();
    await schedule(nurse, patient, dokter, date, 'Kamar operasi 2', '09.00');
    await expect(
      nurse
        .getByRole('region', { name: 'Jadwal kamar' })
        .getByRole('button', { name: new RegExp(patient.patientName), pressed: true }),
    ).toBeVisible();
    await expect(
      nurse.getByText(/Persetujuan tindakan "Kolesistektomi laparoskopik" final ber-TTE/),
    ).toBeVisible();

    // 4.7b · Sign in tertahan tanpa asesmen pra-anestesi final (alasan tertulis, bukan tombol mati).
    await checkPhase(nurse, 'sign-in');
    await expect(nurse.getByText('Asesmen pra-anestesi final belum ada.')).toBeVisible();
    await expect(nurse.getByRole('button', { name: 'Konfirmasi sign in' })).toBeDisabled();
    await expect(nurse.locator('[data-live-status="tersambung"]')).toBeVisible();

    // Dokter (operator, tim) mengisi formulir P07 asesmen pra-anestesi; jendela perawat terbarui lewat SSE aktivitas.
    const doc = await as(browser, dokter, `/penunjang/kamar-operasi?tanggal=${date}`);
    const anest = doc.getByRole('region', { name: 'Anestesi' });
    await anest.getByRole('button', { name: 'Isi asesmen pra-anestesi' }).click();
    const preForm = doc.getByRole('form', { name: 'Isi Asesmen pra-anestesi' });
    await preForm.getByRole('radio', { name: /ASA II · penyakit sistemik ringan/ }).check();
    await preForm
      .getByRole('group', { name: /Operasi darurat/ })
      .getByRole('radio', { name: 'Tidak' })
      .check();
    await preForm.getByLabel(/Mulai puasa/).fill(`${date}T01:00`);
    await preForm
      .getByRole('group', { name: /Mallampati/ })
      .getByRole('radio', { name: 'I', exact: true })
      .check();
    await preForm.getByRole('radio', { name: 'Anestesi umum' }).check();
    await preForm.getByLabel(/Rencana anestesi dan pascaanestesi/).fill('Anestesi umum, pipa endotrakeal');
    await preForm
      .getByRole('group', { name: /Risiko anestesi dijelaskan/ })
      .getByRole('radio', { name: 'Ya' })
      .check();
    await preForm.getByRole('button', { name: 'Simpan asesmen (final)' }).click();
    await expect(anest.getByText(/Asesmen pra-anestesi final · ASA II/)).toBeVisible();
    await expect(
      nurse.getByRole('region', { name: 'Anestesi' }).getByText(/Asesmen pra-anestesi final · ASA II/),
    ).toBeVisible();

    // Sign in: 5 butir manual (butir persetujuan diisi sistem) → konfirmasi.
    await nurse.getByRole('button', { name: 'Konfirmasi sign in' }).click();
    await expect(nurse.getByText(/Sign in dikonfirmasi · induksi dapat dimulai/)).toBeVisible();
    await nurse.getByRole('button', { name: 'Catat induksi' }).click();
    await expect(nurse.getByText('Induksi dicatat.')).toBeVisible();

    // Time out 4 dari 5: konfirmasi nonaktif, insisi terkunci dengan alasan tertulis.
    await checkPhase(nurse, 'time-out', 4);
    await expect(nurse.getByRole('button', { name: /Konfirmasi time out \(1 butir lagi\)/ })).toBeDisabled();
    await expect(nurse.getByRole('button', { name: 'Catat insisi' })).toBeDisabled();
    await expect(nurse.getByText(/Time out belum lengkap \(1 butir tersisa\)/)).toBeVisible();
    await checkPhase(nurse, 'time-out');
    await nurse.getByRole('button', { name: 'Konfirmasi time out' }).click();
    await expect(nurse.getByText(/Time out dikonfirmasi · insisi dapat dicatat/)).toBeVisible();
    await nurse.getByRole('button', { name: 'Catat insisi' }).click();
    await expect(nurse.getByText('Insisi dicatat.')).toBeVisible();

    // Hitung: awal 10/4/20, akhir 9/4/20 → selisih kasa menahan sign out.
    const counts = nurse.getByRole('region', { name: 'Hitung kasa' });
    await counts.getByLabel('Kasa').fill('10');
    await counts.getByLabel('Jarum').fill('4');
    await counts.getByLabel('Instrumen').fill('20');
    await counts.getByRole('button', { name: 'Simpan hitung awal' }).click();
    await expect(nurse.getByText('Hitung awal tercatat.')).toBeVisible();
    await counts.getByLabel('Jenis hitung').selectOption('akhir');
    await counts.getByLabel('Kasa').fill('9');
    await counts.getByLabel('Jarum').fill('4');
    await counts.getByLabel('Instrumen').fill('20');
    await counts.getByRole('button', { name: 'Simpan hitung akhir' }).click();
    await expect(counts.getByText('selisih', { exact: true })).toBeVisible();
    await nurse.getByRole('button', { name: 'Catat luka ditutup' }).click();
    await expect(nurse.getByText('Luka ditutup dicatat.')).toBeVisible();
    await checkPhase(nurse, 'sign-out');
    await nurse.getByRole('button', { name: 'Konfirmasi sign out' }).click();
    await expect(nurse.getByRole('alert').filter({ hasText: /Hitung akhir kasa/ })).toBeVisible();
    await counts
      .getByLabel(/Tindak lanjut selisih kasa/)
      .fill('Rontgen intraoperatif: tidak ada kasa tertinggal');
    await counts.getByRole('button', { name: 'Simpan tindak lanjut' }).click();
    await expect(nurse.getByText('Tindak lanjut selisih tercatat.')).toBeVisible();
    await nurse.getByRole('button', { name: 'Konfirmasi sign out' }).click();
    await expect(nurse.getByText(/Sign out dikonfirmasi · pasien boleh dipindahkan/)).toBeVisible();

    // Operator menulis laporan operasi ber-TTE (jendela dokter yang sama, sudah terbarui lewat SSE).
    const report = doc.getByRole('region', { name: 'Laporan operasi' });
    await report.getByLabel('Diagnosa pra-bedah (ICD-10)').fill('K80.2 Batu kandung empedu');
    await report.getByLabel('Diagnosa pasca-bedah (ICD-10)').fill('K80.2 Batu kandung empedu');
    await report
      .getByLabel('Temuan operasi')
      .fill('Kandung empedu berisi batu multipel, dinding tidak menebal.');
    await report.getByLabel('Spesimen dikirim ke patologi anatomi').check();
    await report.getByRole('button', { name: 'Simpan dan tanda tangani (TTE operator)' }).click();
    await expect(doc.getByText('Laporan operasi tersimpan; TTE operator diminta.')).toBeVisible();
    await expect(report.getByText(/Versi 1 · dr\. Operator/)).toBeVisible();
    // 4.7b · Versi ber-TTE terkunci → adendum; spesimen PA terstruktur dari laporan.
    await expect(report.getByRole('button', { name: 'Koreksi laporan' })).toHaveCount(0);
    await report.getByRole('button', { name: 'Tambah adendum' }).click();
    await report
      .getByLabel('Isi adendum')
      .fill('Adendum: kandung empedu dikirim utuh, tidak ada kebocoran empedu.');
    await report.getByRole('button', { name: 'Simpan adendum (TTE operator)' }).click();
    await expect(doc.getByText('Adendum laporan tersimpan; TTE operator diminta.')).toBeVisible();
    await expect(report.getByRole('list', { name: 'Adendum laporan' })).toContainText(
      'kandung empedu dikirim utuh',
    );
    const pa = doc.getByRole('region', { name: 'Spesimen patologi anatomi' });
    await pa.getByLabel('Asal jaringan').fill('Kandung empedu');
    await pa
      .getByLabel('Diagnosis klinis / pertanyaan untuk patolog')
      .fill('Kolelitiasis, singkirkan keganasan');
    await pa.getByRole('button', { name: 'Kirim spesimen ke PA' }).click();
    await expect(doc.getByText('Spesimen dikirim ke patologi anatomi.')).toBeVisible();
    await expect(pa.getByText(/OK-\d{4}-\d{4}-S1/)).toBeVisible();

    await nurse.getByRole('button', { name: 'Catat pasien keluar kamar' }).click();
    await expect(nurse.getByText('Pasien keluar kamar dicatat.')).toBeVisible();
    await expect(nurse.getByText('Selesai', { exact: true }).first()).toBeVisible();
  });

  test('override insisi sebelum time out (dua jendela, SSE): dokter beralasan ≥ 15 karakter, tercatat di peristiwa', async ({
    browser,
  }) => {
    // Dua sesi (perawat + dokter) dengan login TOTP: lebih lama dari batas bawaan 60 dtk saat mesin sibuk.
    test.setTimeout(120_000);
    const tag = newId().slice(-4).toUpperCase();
    const { dokter, perawat, patient } = await setup(tag);
    const date = randomDate();
    await preAnesthesiaDb(patient, dokter);
    const nurse = await as(browser, perawat, `/penunjang/kamar-operasi?tanggal=${date}`);
    await schedule(nurse, patient, dokter, date, 'Kamar operasi 3', '13.00');
    // Jendela dokter (operator, anggota tim) terbuka sebelum sign in: centang butir dan perubahan status dari perawat
    // sampai lewat SSE aktivitas papan OK (4.7b) tanpa muat ulang manual.
    const doc = await as(browser, dokter, `/penunjang/kamar-operasi?tanggal=${date}`);
    const docCase = doc.getByRole('region', { name: 'Daftar tilik keselamatan' });
    await expect(docCase.getByText('Terjadwal', { exact: true })).toBeVisible();
    await expect(doc.locator('[data-live-status="tersambung"]')).toBeVisible();

    await checkPhase(nurse, 'sign-in', 1);
    await expect(doc.locator('input[data-phase="sign-in"][data-item="sign-in-1"]')).toBeChecked();
    await checkPhase(nurse, 'sign-in');
    await nurse.getByRole('button', { name: 'Konfirmasi sign in' }).click();
    await expect(nurse.getByText(/Sign in dikonfirmasi/)).toBeVisible();
    await expect(docCase.getByText('Persiapan (sign in)', { exact: true })).toBeVisible();
    await nurse.getByRole('button', { name: 'Catat induksi' }).click();
    await expect(nurse.getByText('Induksi dicatat.')).toBeVisible();
    await expect(docCase.getByText('Sedang berlangsung', { exact: true })).toBeVisible();
    // Perawat tidak punya override: formulir override tidak tampil.
    await expect(nurse.getByRole('form', { name: 'Override insisi' })).toHaveCount(0);

    const ovr = doc.getByRole('form', { name: 'Override insisi' });
    await ovr.getByLabel(/Override dokter/).fill('pendek');
    await expect(ovr.getByRole('button', { name: 'Catat insisi dengan override' })).toBeDisabled();
    await ovr.getByLabel(/Override dokter/).fill('Perdarahan aktif, tidak bisa menunggu time out');
    await ovr.getByRole('button', { name: 'Catat insisi dengan override' }).click();
    await expect(doc.getByText(/Override time out tercatat \(ditinjau mutu\)/)).toBeVisible();
    await expect(doc.getByRole('region', { name: 'Peristiwa operasi' })).toContainText(
      'override: Perdarahan aktif, tidak bisa menunggu time out',
    );
  });
});
