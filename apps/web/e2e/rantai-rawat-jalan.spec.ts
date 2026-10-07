import { type ConsoleMessage, expect, type Page, type Response, test } from '@playwright/test';
import { newId } from '@simrs/shared';
import { createAccount, createPatient, inTenant, loginAs, TENANTS } from './support/accounts';
import { useTestDevice } from './support/devices';
import {
  activeBpjsCard,
  bpjsTaskStatuses,
  createJknBooking,
  hfisSession,
  rujukanNo,
  sepOf,
} from './support/front-office';
import { ensureRsfaSchedule } from './support/schedule';
import { stagingOf } from './support/staging';

/**
 * Rantai lintas layar rawat jalan mode api (jaring regresi agen BUG, diperluas A1 menjadi E2E penutup fase 3 §3.9):
 * booking JKN → anjungan check-in → nomor loket dipanggil di Kendali antrean → layar Pendaftaran (BPJS: kepesertaan,
 * rujukan, SEP terbit lewat mock) → perawat poli mengukur TTV → dokter yang terikat jadwal HFIS membuka Pemeriksaan
 * poli dari menu, memanggil pasien, mulai periksa (task 4) → CPOE kunjungan yang sama: order lab + resep berlergi
 * DIBLOKIR CDS lalu override beralasan → SOAP + ICD-10 → tanda tangani dan selesai (CPPT final, resume RJ ber-TTE,
 * kunjungan selesai, task 5) → staging SATUSEHAT `held` + `billable_events`.
 * Setiap layar staf dan perangkat yang dibuka di rantai ini dijaga tanpa galat konsol/halaman dan tanpa respons 5xx.
 * Data fiktif (NIK 9999…, kartu 0000…).
 */

const digits = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');

/** Galat konsol/halaman + respons ≥ 500 sepanjang hidup halaman (anjungan, loket, dokter). */
function watchErrors(page: Page, label: string, sink: string[]) {
  page.on('pageerror', (e) => sink.push(`${label} pageerror: ${e.message}`));
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() === 'error' && !`${m.text()} ${m.location().url}`.includes('favicon')) {
      sink.push(`${label} console: ${m.text()}`);
    }
  });
  page.on('response', (r: Response) => {
    if (r.status() >= 500) sink.push(`${label} ${r.status()} ${r.request().method()} ${r.url()}`);
  });
}

async function typeDigits(page: Page, value: string) {
  const keypad = page.getByRole('group', { name: 'Keypad angka' });
  for (const d of value) await keypad.getByRole('button', { name: `Angka ${d}` }).click();
}

test.beforeAll(async () => {
  await ensureRsfaSchedule();
});

test('rantai rawat jalan (api): booking JKN → anjungan → SEP → poli + CPOE (CDS) → resume RJ ber-TTE → task 5', async ({
  page,
  browser,
}, info) => {
  test.skip(
    info.project.name !== 'desktop',
    'Satu proyek saja: anjungan uji, antrean loket/poli RSFA, dan praktisi HFIS dipakai bersama.',
  );
  test.setTimeout(300_000);
  const session = await hfisSession();
  test.skip(
    !session,
    'Hari Minggu: tidak ada praktik poli PD di HFIS mock, Antrean BPJS menolak booking JKN.',
  );
  if (!session) return;
  const errors: string[] = [];
  const suffix = digits(4);

  // Dokter + perawat uji di unit Poli Penyakit Dalam; dokter terikat ke praktisi jadwal HFIS hari ini (SEP + Antrean
  // BPJS memakai kode praktisi itu), sehingga pendaftaran memberi relasi DPJP ke akun uji.
  const staffIn = async (role: string, displayName: string) => {
    const acc = await createAccount({ displayName });
    await inTenant(TENANTS.RSFA, async (tx) => {
      const r = await tx.role.findFirstOrThrow({ where: { code: role } });
      const unit = await tx.unit.findFirstOrThrow({ where: { code: 'POLI-DALAM' } });
      await tx.staffAssignment.create({
        data: { id: newId(), tenantId: TENANTS.RSFA, userId: acc.id, roleId: r.id, unitId: unit.id },
      });
    });
    return acc;
  };
  const doctor = await staffIn('dokter', `dr. Rantai ${suffix} Fiktif, Sp.PD`);
  const nurse = await staffIn('perawat', `Ns. Rantai ${suffix} Fiktif`);
  const practitionerId = await inTenant(TENANTS.RSFA, async (tx) => {
    const row = await tx.scheduleSession.findUniqueOrThrow({
      where: { id: session.id },
      select: { practitionerId: true },
    });
    await tx.practitioner.update({ where: { id: row.practitionerId }, data: { userId: doctor.id } });
    return row.practitionerId;
  });

  // Pasien JKN fiktif beralergi amoksisilin (dicatat terkode); persetujuan umum sudah ada.
  const card = activeBpjsCard();
  const nik = `9999${digits(12)}`;
  const patientName = `Rantai ${suffix} Fiktif`;
  const patient = await createPatient('RSFA', {
    name: patientName,
    sex: 'female',
    birthDate: '1979-09-23',
    phone: `62812${digits(8)}`,
    identifiers: { nik, bpjs: card },
  });
  await inTenant(TENANTS.RSFA, async (tx) => {
    await tx.privacyConsent.create({
      data: {
        id: newId(),
        tenantId: TENANTS.RSFA,
        patientId: patient.id,
        kind: 'umum',
        note: 'Persetujuan uji',
      },
    });
    const substance = await tx.drugSubstance.findUniqueOrThrow({
      where: { tenantId_code: { tenantId: TENANTS.RSFA, code: 'amoksisilin' } },
    });
    const allergyId = newId();
    await tx.allergyIntolerance.create({
      data: {
        id: allergyId,
        rootId: allergyId,
        tenantId: TENANTS.RSFA,
        patientId: patient.id,
        occurredAt: new Date(),
        authorUserId: doctor.id,
        authorRole: 'dokter',
        kind: 'alergi',
        substanceId: substance.id,
        text: 'Amoksisilin',
        category: 'obat',
        criticality: 'tinggi',
        reaction: 'Urtikaria',
      },
    });
  });

  // 0) Booking JKN hari ini lewat API (kuota, nomor poli cadangan, `bpjs.antrean.add`), token petugas loket.
  watchErrors(page, 'loket', errors);
  const loket = await createAccount({ roles: ['petugas_pendaftaran'] });
  await loginAs(page, loket, '/antrean');
  const booking = await createJknBooking(page.context(), {
    patientId: patient.id,
    sessionId: session.id,
    referenceNumber: rujukanNo(card),
  });

  // 1) Anjungan (perangkat terdaftar): NIK → DDMM → nama tersamar → check-in → nomor loket A-xxx.
  const kioskContext = await browser.newContext();
  await useTestDevice(kioskContext, 'kiosk');
  const kiosk = await kioskContext.newPage();
  watchErrors(kiosk, 'anjungan', errors);
  await kiosk.goto('/kiosk');
  await kiosk.getByRole('button', { name: /Saya sudah punya booking/ }).click();
  await kiosk.getByRole('button', { name: /NIK e-KTP/ }).click();
  await typeDigits(kiosk, nik);
  await kiosk.getByRole('button', { name: 'Lanjut' }).click();
  await expect(kiosk.getByRole('heading', { name: 'Masukkan tanggal dan bulan lahir' })).toBeVisible();
  await typeDigits(kiosk, '2309');
  await kiosk.getByRole('button', { name: 'Lanjut' }).click();
  await kiosk.getByRole('button', { name: 'Ya, data saya benar · check-in' }).click();
  const slip = kiosk.getByRole('region', { name: 'Tiket antrean' });
  await expect(slip).toContainText('Loket Pendaftaran');
  const counterNo = /A-\d{3}/.exec((await slip.textContent()) ?? '')?.[0] ?? '';
  expect(counterNo).not.toBe('');
  await kiosk.getByRole('button', { name: 'Selesai' }).click();
  await kioskContext.close();

  // 2) Loket memanggil nomor anjungan (task 2), lalu mendaftarkan pasien JKN: kepesertaan → rujukan → SEP (task 3).
  await page.goto('/antrean');
  await page.getByRole('navigation', { name: 'Layanan antrean' }).getByRole('link', { name: /^A\s/ }).click();
  await page
    .getByRole('listitem', { name: `${counterNo} · Menunggu` })
    .getByRole('button', { name: `Panggil ${counterNo}` })
    .click();
  await expect(page.getByRole('listitem', { name: `${counterNo} · Dipanggil` })).toBeVisible();

  await page.goto('/pendaftaran');
  await page.getByLabel('Cari pasien (NIK, No. RM, No. BPJS, atau nama)').fill(card);
  await page.getByRole('button', { name: 'Cari pasien' }).click();
  await expect(page.getByRole('region', { name: 'Identitas pasien' })).toContainText(patientName);
  await page.getByRole('button', { name: 'Cek kepesertaan' }).click();
  const rujukan = page.getByRole('button', { name: new RegExp(`Rujukan FKTP.*${card.slice(-9)}01`) });
  await expect(rujukan).toBeEnabled();
  await rujukan.click();
  await page.getByRole('button', { name: session.label }).click();
  await page.getByRole('button', { name: 'Daftarkan dan terbitkan SEP' }).click();
  await expect(
    page.getByRole('heading', { name: 'Pendaftaran rawat jalan selesai', level: 1 }),
  ).toBeVisible();
  const encounterId = new URL(page.url()).searchParams.get('kunjungan') ?? '';
  expect(encounterId).toMatch(/^[0-9a-f-]{36}$/);
  const poliNo = (await page.getByText(/^PD-\d{3}$/).textContent()) ?? '';
  expect(poliNo).toMatch(/^PD-\d{3}$/);
  const stored = await inTenant(TENANTS.RSFA, (tx) =>
    tx.encounter.findUniqueOrThrow({
      where: { id: encounterId },
      select: { patientId: true, practitionerId: true, appointmentId: true },
    }),
  );
  // Booking yang sudah check-in di anjungan dipakai pendaftaran (bukan kunjungan baru tanpa booking).
  expect(stored).toMatchObject({ patientId: patient.id, practitionerId, appointmentId: booking.id });
  await expect(
    page.getByRole('region', { name: 'Status SEP dan Antrean BPJS' }).getByText('SEP terbit'),
  ).toBeVisible({ timeout: 60_000 });
  expect((await sepOf(encounterId))?.status).toBe('issued');

  // 2b) Perawat poli: tanda vital lengkap di Pemeriksaan poli (NEWS2 dihitung server).
  const nurseContext = await browser.newContext();
  const ns = await nurseContext.newPage();
  watchErrors(ns, 'perawat', errors);
  try {
    await loginAs(ns, nurse, `/klinis/poli?pasien=${patient.id}`);
    await ns.getByRole('button', { name: 'Ukur ulang tanda vital' }).click();
    await ns.getByLabel('Tekanan darah (mmHg)').fill('152/96');
    await ns.getByLabel('Nadi (x/mnt)').fill('90');
    await ns.getByLabel('Suhu (°C)').fill('38,2');
    await ns.getByLabel('SpO2 (%)').fill('98');
    await ns.getByLabel('Napas (x/mnt)').fill('18');
    await ns.getByLabel('Kesadaran (ACVPU)').selectOption('A');
    await ns.getByRole('button', { name: 'Simpan tanda vital' }).click();
    await expect(ns.getByText(/Tanda vital tersimpan/)).toBeVisible();
  } finally {
    await nurseContext.close();
  }

  // 3) Dokter jadwal di Pemeriksaan poli (W1, dari menu): pasien hasil pendaftaran ada di antrean poli → panggil
  //    (task 4) → mulai periksa → CPOE kunjungan yang sama (order lab) → SOAP + ICD-10 → tanda tangani dan selesai →
  //    resume rawat jalan (W5b) terbuka.
  const doctorContext = await browser.newContext();
  const doc = await doctorContext.newPage();
  watchErrors(doc, 'dokter', errors);
  try {
    await loginAs(doc, doctor, '/');
    const nav = doc.getByRole('navigation', { name: 'Navigasi utama' });
    await nav.getByRole('link', { name: 'Pasien saya' }).click();
    await expect(doc.getByRole('heading', { name: 'Pemeriksaan pasien', level: 1 })).toBeVisible();
    await doc.goto(`/klinis/poli?pasien=${patient.id}`);
    await expect(doc.getByText(patientName).first()).toBeVisible();
    await expect(doc.getByText('152/96')).toBeVisible();
    await doc.getByRole('button', { name: `Panggil pasien · ${poliNo}` }).click();
    await expect(doc.getByText(new RegExp(`${poliNo} dipanggil`))).toBeVisible();
    await doc.getByRole('button', { name: 'Mulai periksa' }).click();
    await expect(doc.getByText(new RegExp(`Pemeriksaan ${poliNo} dimulai`))).toBeVisible();

    // CPOE dari menu: kunjungan pasien ini ada di daftar (worklist DPJP dari jadwal), order lab terkirim.
    await nav.getByRole('link', { name: 'Order & resep (CPOE)' }).click();
    await expect(doc).toHaveURL(/\/klinis\/order$/);
    const row = doc
      .getByRole('region', { name: 'Kunjungan berjalan' })
      .getByRole('link')
      .filter({ hasText: patientName });
    await expect(row).toBeVisible();
    await row.click();
    await expect(doc).toHaveURL(new RegExp(`/klinis/order/${encounterId}$`));
    await expect(doc.getByLabel('Identitas pasien')).toContainText(patientName);
    await doc.getByLabel('Cari pemeriksaan, obat, tindakan').fill('hemoglobin');
    await doc
      .getByRole('button', { name: /^Tambah Hemoglobin/ })
      .first()
      .click();
    const send = doc.getByRole('button', { name: 'Kirim 1 order' });
    await expect(send).toBeEnabled();
    await send.click();
    await expect(doc.getByRole('status').filter({ hasText: '1 order terkirim' })).toBeVisible();
    // Resep berlergi: sefadroksil (reaksi silang penisilin) diblokir CDS server; override beralasan → terkirim.
    await doc.getByLabel('Cari pemeriksaan, obat, tindakan').fill('sefadroksil');
    await doc.getByRole('button', { name: 'Tambah Sefadroksil 500 mg kapsul' }).click();
    const gate = doc.getByRole('alert').filter({ hasText: 'CDS memblokir Sefadroksil 500 mg kapsul' });
    await expect(gate).toBeVisible();
    await doc.getByRole('textbox', { name: /^Dosis/ }).fill('500 mg');
    await doc.getByRole('combobox', { name: /^Aturan pakai/ }).selectOption('2x1');
    const sendRx = doc.getByRole('button', { name: 'Kirim 1 order' });
    await expect(sendRx).toBeDisabled();
    const reason = 'Riwayat sefadroksil tanpa reaksi; alternatif oral tidak tersedia';
    await gate.getByRole('button', { name: 'Override dengan alasan' }).click();
    await gate.getByLabel(/Alasan klinis/).fill(reason);
    await gate.getByRole('button', { name: 'Simpan alasan dan lanjut' }).click();
    await expect(sendRx).toBeEnabled();
    await sendRx.click();
    await expect(doc.getByRole('status').filter({ hasText: '1 order terkirim' })).toContainText(
      'resep dikirim untuk TTE',
    );
    const orders = await inTenant(TENANTS.RSFA, async (tx) => ({
      groups: await tx.orderGroup.count({ where: { encounterId, orderedBy: doctor.id } }),
      alerts: await tx.cdsAlert.findMany({
        where: { encounterId },
        select: { decision: true, overrideReason: true },
      }),
    }));
    expect(orders).toEqual({ groups: 2, alerts: [{ decision: 'override', overrideReason: reason }] });

    // Kembali ke poli: SOAP + diagnosis → tanda tangani dan selesai → resume RJ.
    await doc.goto(`/klinis/poli?pasien=${patient.id}`);
    await doc.getByLabel('S · Subjektif').fill('Demam dan lemas sejak 2 hari');
    await doc.getByLabel('O · Objektif').fill('Suhu 38,2 °C, konjungtiva tidak anemis');
    await doc.getByRole('button', { name: '+ Tambah diagnosis' }).click();
    await doc.getByLabel('Pilih kode ICD-10').selectOption('I10');
    await doc.getByLabel('Catatan rencana (P)').fill('Cek hemoglobin, kontrol bila demam menetap');
    await doc.getByLabel('Tindak lanjut / kontrol').fill('Kontrol Poli Penyakit Dalam 1 minggu');
    await doc.getByLabel('Kondisi pulang').selectOption('Stabil');
    await doc.getByLabel('Cara pulang').selectOption('pulang');
    await doc.getByRole('button', { name: 'Tanda tangani dan selesai' }).click();
    await expect(doc.getByText(/Kunjungan selesai · ditandatangani/)).toBeVisible({ timeout: 20_000 });
    await doc.getByRole('link', { name: 'Buka resume' }).click();
    await expect(doc).toHaveURL(new RegExp(`/klinis/resume/${encounterId}`));
    await expect(doc.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await expect(doc.getByText('Belum tersambung', { exact: true })).toHaveCount(0);
    await expect(doc.getByText('Akses ditolak')).toHaveCount(0);
    await expect(doc.getByText(/Resume final · versi 1/)).toBeVisible();
    await expect(doc.getByRole('link', { name: 'Cetak PDF resume' })).toBeVisible();

    const state = await inTenant(TENANTS.RSFA, async (tx) => ({
      enc: await tx.encounter.findUniqueOrThrow({
        where: { id: encounterId },
        select: { status: true, disposition: true },
      }),
      resume: await tx.dischargeSummary.findMany({
        where: { encounterId, kind: 'rawat_jalan' },
        select: { id: true },
      }),
    }));
    expect(state.enc).toEqual({ status: 'finished', disposition: 'pulang' });
    expect(state.resume).toHaveLength(1);
    const tte = await inTenant(TENANTS.RSFA, (tx) =>
      tx.documentSignature.findFirst({
        where: { document: { sourceType: 'discharge_summaries', sourceId: state.resume[0]?.id } },
        select: { status: true },
      }),
    );
    expect(['pending', 'signed']).toContain(tte?.status);
  } finally {
    await doctorContext.close();
  }

  // Task ID Antrean BPJS 1–5 tercatat untuk booking JKN ini (4 = mulai periksa, 5 = tutup poli).
  await expect
    .poll(async () => (await bpjsTaskStatuses(booking.id)).map((t) => t.taskId), { timeout: 30_000 })
    .toEqual(expect.arrayContaining([1, 2, 3, 4, 5]));

  // Staging lintas fase (ADR-0032): SATUSEHAT `held` saja (tidak ada yang terkirim) + biaya tanpa harga.
  const staging = await stagingOf([encounterId]);
  expect(staging.notHeld).toEqual([]);
  expect(staging.held).toEqual(
    expect.arrayContaining([
      'composition',
      'condition',
      'encounter',
      'medicationrequest',
      'observation',
      'servicerequest',
    ]),
  );
  expect(staging.billable).toEqual(expect.arrayContaining(['lab']));

  expect(errors).toEqual([]);
});
