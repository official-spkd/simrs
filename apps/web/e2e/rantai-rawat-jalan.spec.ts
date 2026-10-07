import { type ConsoleMessage, expect, type Page, type Response, test } from '@playwright/test';
import { toDbDate } from '@simrs/db';
import { isoDateJakarta, newId } from '@simrs/shared';
import { createAccount, createPatient, inTenant, loginAs, TENANTS } from './support/accounts';
import { useTestDevice } from './support/devices';
import { createNonJknBooking } from './support/front-office';
import { ensureRsfaSchedule } from './support/schedule';

/**
 * Rantai lintas layar rawat jalan mode api (jaring regresi agen BUG): booking (aplikasi RS) → anjungan check-in →
 * nomor loket dipanggil di Kendali antrean → layar Pendaftaran (penjamin umum) → nomor poli dipanggil → dokter yang
 * terikat jadwal melihat pasiennya di daftar CPOE (worklist DPJP, relasi akses dari pendaftaran) → order lab terkirim.
 * Setiap layar staf dan perangkat yang dibuka di rantai ini dijaga tanpa galat konsol/halaman dan tanpa respons 5xx.
 * Data fiktif (NIK 9999…); sesi praktik milik dokter uji sendiri agar tidak berebut kuota dengan spesifikasi lain.
 */

const digits = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');

/** Galat konsol/halaman + respons ≥ 500 sepanjang hidup halaman (anjungan, loket, dokter). */
function watchErrors(page: Page, label: string, sink: string[]) {
  page.on('pageerror', (e) => sink.push(`${label} pageerror: ${e.message}`));
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() === 'error') sink.push(`${label} console: ${m.text()}`);
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

test('rantai rawat jalan (api): booking → anjungan → loket → pendaftaran → poli → CPOE dokter jadwal', async ({
  page,
  browser,
}, info) => {
  test.skip(
    info.project.name !== 'desktop',
    'Satu proyek saja: anjungan uji dan antrean loket/poli RSFA dipakai bersama.',
  );
  test.setTimeout(180_000);
  const errors: string[] = [];
  const suffix = digits(4);

  // Dokter uji yang terikat ke data praktisi jadwal (practitioner.userId), dengan sesi poli PD hari ini.
  const doctorName = `dr. Rantai ${suffix} Fiktif, Sp.PD`;
  const doctor = await createAccount({ roles: ['dokter'], displayName: doctorName });
  const today = isoDateJakarta();
  const minute = String(Math.floor(Math.random() * 60)).padStart(2, '0');
  const sessionLabel = new RegExp(`${doctorName.replace(/[.,]/g, '\\$&')}\\s*04\\.${minute}–23\\.59`);
  const { slot } = await inTenant(TENANTS.RSFA, async (tx) => {
    const service = await tx.queueService.findFirstOrThrow({ where: { code: 'PD' }, select: { id: true } });
    const practitionerId = newId();
    await tx.practitioner.create({
      data: { id: practitionerId, tenantId: TENANTS.RSFA, name: doctorName, userId: doctor.id },
    });
    const sessionId = newId();
    await tx.scheduleSession.create({
      data: {
        id: sessionId,
        tenantId: TENANTS.RSFA,
        practitionerId,
        serviceId: service.id,
        sessionDate: toDbDate(today),
        startTime: new Date(`1970-01-01T04:${minute}:00Z`),
        endTime: new Date('1970-01-01T23:59:00Z'),
        quotaJkn: 5,
        quotaNonJkn: 5,
      },
    });
    return { slot: { serviceId: service.id, practitionerId, sessionId } };
  });

  // Pasien umum; persetujuan umum sudah ada dari kunjungan sebelumnya.
  const nik = `9999${digits(12)}`;
  const patientName = `Rantai ${suffix} Fiktif`;
  const patient = await createPatient('RSFA', {
    name: patientName,
    sex: 'female',
    birthDate: '1979-09-23',
    identifiers: { nik },
  });
  await inTenant(TENANTS.RSFA, (tx) =>
    tx.privacyConsent.create({
      data: { id: newId(), tenantId: TENANTS.RSFA, patientId: patient.id, kind: 'umum', note: 'Persetujuan uji' },
    }),
  );

  // 0) Booking umum hari ini lewat API (kuota + nomor poli cadangan oleh layanan booking), token petugas loket.
  watchErrors(page, 'loket', errors);
  const loket = await createAccount({ roles: ['petugas_pendaftaran'] });
  await loginAs(page, loket, '/antrean');
  const booking = await createNonJknBooking(page.context(), {
    patientId: patient.id,
    sessionId: slot.sessionId,
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

  // 2) Loket memanggil nomor anjungan, lalu mendaftarkan pasien (penjamin umum, sesi dokter jadwal).
  await page.goto('/antrean');
  await page.getByRole('navigation', { name: 'Layanan antrean' }).getByRole('link', { name: /^A\s/ }).click();
  await page
    .getByRole('listitem', { name: `${counterNo} · Menunggu` })
    .getByRole('button', { name: `Panggil ${counterNo}` })
    .click();
  await expect(page.getByRole('listitem', { name: `${counterNo} · Dipanggil` })).toBeVisible();

  await page.goto('/pendaftaran');
  await page.getByLabel('Cari pasien (NIK, No. RM, No. BPJS, atau nama)').fill(patient.mrn);
  await page.getByRole('button', { name: 'Cari pasien' }).click();
  await page.getByRole('button', { name: new RegExp(`Pilih ${patientName}, RM ${patient.mrn}`) }).click();
  await expect(page.getByRole('region', { name: 'Identitas pasien' })).toContainText(patientName);
  await expect(page.getByRole('heading', { name: 'Penjamin: Umum (bayar sendiri)' })).toBeVisible();
  await expect(page.getByText('Persetujuan umum rawat jalan berlaku')).toBeVisible();
  await page.getByRole('button', { name: sessionLabel }).click();
  await page.getByRole('button', { name: 'Daftarkan', exact: true }).click();
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
  expect(stored).toMatchObject({
    patientId: patient.id,
    practitionerId: slot.practitionerId,
    appointmentId: booking.id,
  });

  // 3) Poli memanggil nomor poli pasien.
  await page.goto('/antrean');
  await page.getByRole('navigation', { name: 'Layanan antrean' }).getByRole('link', { name: /^PD\s/ }).click();
  await page
    .getByRole('listitem', { name: `${poliNo} · Menunggu` })
    .getByRole('button', { name: `Panggil ${poliNo}` })
    .click();
  await expect(page.getByRole('listitem', { name: `${poliNo} · Dipanggil` })).toBeVisible();

  // 4) Dokter jadwal: pasien tampil di daftar kunjungan CPOE (tanpa diatur manual), order lab terkirim.
  const doctorContext = await browser.newContext();
  const doc = await doctorContext.newPage();
  watchErrors(doc, 'dokter', errors);
  try {
    await loginAs(doc, doctor, '/klinis/poli');
    await expect(doc.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await expect(doc.getByText('Akses ditolak')).toHaveCount(0);
    await doc.goto('/klinis/order');
    const row = doc
      .getByRole('region', { name: 'Kunjungan berjalan' })
      .getByRole('link')
      .filter({ hasText: patientName });
    await expect(row).toBeVisible();
    await row.click();
    await expect(doc).toHaveURL(new RegExp(`/klinis/order/${encounterId}$`));
    await expect(doc.getByLabel('Identitas pasien')).toContainText(patientName);
    await doc.getByLabel('Cari pemeriksaan, obat, tindakan').fill('hemoglobin');
    await doc.getByRole('button', { name: /^Tambah Hemoglobin/ }).first().click();
    const send = doc.getByRole('button', { name: 'Kirim 1 order' });
    await expect(send).toBeEnabled();
    await send.click();
    await expect(doc.getByRole('status').filter({ hasText: '1 order terkirim' })).toBeVisible();
    await expect(
      doc.getByRole('region', { name: 'Order kunjungan ini' }).getByText(/Hemoglobin/).first(),
    ).toBeVisible();
    const orders = await inTenant(TENANTS.RSFA, (tx) =>
      tx.orderGroup.count({ where: { encounterId, orderedBy: doctor.id } }),
    );
    expect(orders).toBe(1);
  } finally {
    await doctorContext.close();
  }

  expect(errors).toEqual([]);
});
