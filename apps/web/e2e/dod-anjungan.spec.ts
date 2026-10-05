import { expect, test } from '@playwright/test';
import { createPrismaClient } from '@simrs/db';
import { testDbUrls } from '@simrs/db/testing';
import { createAccount, createPatient, loginAs, TENANTS } from './support/accounts';
import { registerBoundTestDisplay, useDeviceToken, useTestDevice } from './support/devices';
import {
  bpjsTaskStatuses,
  createJknBooking,
  hfisSession,
  mockAntrean,
  mockSep,
  rujukanNo,
  sepOf,
} from './support/front-office';
import { ensureRsfaSchedule } from './support/schedule';

/**
 * DoD fase 2 · rantai penuh dengan mock (potongan 9): booking JKN → anjungan (perangkat terdaftar) check-in → nomor
 * loket A-xxx dipanggil di Kendali antrean → petugas mendaftarkan di layar Pendaftaran → SEP terbit lewat mock BPJS →
 * nomor poli PD-xxx dipanggil dan tampil di TV display lewat SSE → task 1–3 diterima Antrean BPJS mock (API panel)
 * dan berstatus `sent`. Tidak mengubah skenario mock (keadaan bersama), jadi aman berjalan paralel dengan tes lain.
 * Data fiktif (NIK 9999…, kartu 0000…).
 */

const digits = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');

/** Token TV uji yang terikat ke papan seed `RJ-LT2` (poli PD/JT/SR/PR). */
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

test('DoD: anjungan → loket → SEP → PD-xxx di display → task 1–3 terkirim', async ({
  page,
  browser,
}, info) => {
  test.skip(
    info.project.name !== 'desktop',
    'Satu proyek saja: anjungan, TV, dan antrean RSFA dipakai bersama.',
  );
  test.setTimeout(240_000);
  const session = await hfisSession();
  test.skip(!session, 'Hari Minggu: tidak ada praktik poli PD di HFIS mock, Antrean BPJS menolak booking.');
  if (!session) return;

  // Pasien JKN fiktif (Antrean BPJS mewajibkan no. HP) dengan rujukan FKTP aktif di mock.
  const card = `0000${digits(8)}1`;
  const patient = await createPatient('RSFA', {
    name: 'Bambang Rahardjo Fiktif',
    sex: 'male',
    birthDate: '1968-11-02',
    phone: `62812${digits(8)}`,
    identifiers: { nik: `99990211680${digits(5)}`, bpjs: card },
  });

  // Booking JKN hari ini (kanal loket lewat API, seperti dari Mobile JKN): Antrean BPJS menerima kode booking.
  const loket = await createAccount({ roles: ['petugas_pendaftaran'] });
  await loginAs(page, loket, '/antrean');
  const booking = await createJknBooking(page.context(), {
    patientId: patient.id,
    sessionId: session.id,
    referenceNumber: rujukanNo(card),
  });
  await expect.poll(() => mockAntrean(booking.bookingCode), { timeout: 30_000 }).not.toBeNull();

  // TV ruang tunggu (perangkat display terdaftar, tanpa akun staf) tersambung lebih dulu.
  const tvContext = await browser.newContext();
  await useDeviceToken(tvContext, tvToken);
  const tv = await tvContext.newPage();
  await tv.goto('/display/antrean');
  await expect(tv.getByRole('group', { name: 'Kontrol perangkat' }).getByRole('status')).toHaveText(
    'Tersambung',
  );

  // 1) Anjungan: kode booking → nama tersamar → check-in → nomor loket pendaftaran (task 1).
  const kioskContext = await browser.newContext();
  await useTestDevice(kioskContext, 'kiosk');
  const kiosk = await kioskContext.newPage();
  await kiosk.goto('/kiosk');
  await kiosk.getByRole('button', { name: /Saya sudah punya booking/ }).click();
  await kiosk.getByRole('button', { name: /Kode booking/ }).click();
  const keypad = kiosk.getByRole('group', { name: 'Keypad angka' });
  for (const d of booking.bookingCode) await keypad.getByRole('button', { name: `Angka ${d}` }).click();
  await kiosk.getByRole('button', { name: 'Lanjut' }).click();
  await expect(kiosk.getByTestId('nama-tersamar')).toHaveText('Ba••••• Ra•••••• Fi••••');
  await kiosk.getByRole('button', { name: 'Ya, data saya benar · check-in' }).click();
  const slip = kiosk.getByRole('region', { name: 'Tiket antrean' });
  await expect(slip).toContainText(`Check-in booking ${booking.bookingCode} berhasil`);
  const counterNo = /A-\d{3}/.exec((await slip.textContent()) ?? '')?.[0] ?? '';
  expect(counterNo).not.toBe('');
  await kioskContext.close();

  // 2) Loket memanggil nomor anjungan itu di Kendali antrean (task 2).
  await page.goto('/antrean');
  await page.getByRole('navigation', { name: 'Layanan antrean' }).getByRole('link', { name: /^A\s/ }).click();
  await page
    .getByRole('listitem', { name: `${counterNo} · Menunggu` })
    .getByRole('button', {
      name: `Panggil ${counterNo}`,
    })
    .click();
  await expect(page.getByRole('listitem', { name: `${counterNo} · Dipanggil` })).toBeVisible();

  // 3) Registrasi di layar Pendaftaran: booking yang sudah check-in dipakai, SEP pending → terbit lewat mock (task 3).
  await page.goto('/pendaftaran');
  await page.getByLabel('Cari pasien (NIK, No. RM, No. BPJS, atau nama)').fill(card);
  await page.getByRole('button', { name: 'Cari pasien' }).click();
  await expect(page.getByRole('region', { name: 'Identitas pasien' })).toContainText(
    'Bambang Rahardjo Fiktif',
  );
  await page.getByRole('button', { name: 'Cek kepesertaan' }).click();
  const rujukan = page.getByRole('button', { name: new RegExp(`Rujukan FKTP.*${card.slice(-9)}01`) });
  await expect(rujukan).toBeEnabled();
  await rujukan.click();
  await page.getByRole('button', { name: session.label }).click();
  await page.getByLabel(/Persetujuan umum sudah ditandatangani/).check();
  await page.getByRole('button', { name: 'Daftarkan dan terbitkan SEP' }).click();
  await expect(
    page.getByRole('heading', { name: 'Pendaftaran rawat jalan selesai', level: 1 }),
  ).toBeVisible();
  const encounterId = new URL(page.url()).searchParams.get('kunjungan') ?? '';
  const poliNo = (await page.getByText(/^PD-\d{3}$/).textContent()) ?? '';
  expect(poliNo).toMatch(/^PD-\d{3}$/);
  const status = page.getByRole('region', { name: 'Status SEP dan Antrean BPJS' });
  await expect(status.getByText('SEP terbit')).toBeVisible({ timeout: 60_000 });
  const sep = await sepOf(encounterId);
  expect(sep?.status).toBe('issued');
  expect(await mockSep(sep?.sepNo ?? '-')).toMatchObject({ noKartu: card });
  // Nomor poli = nomor yang dikirim ke Antrean BPJS saat booking (cadangan booking dilepas ke antrean).
  expect((await mockAntrean(booking.bookingCode))?.nomorantrean).toBe(poliNo);

  // 4) Poli memanggil nomor itu → TV menampilkan PD-xxx lewat SSE tanpa dimuat ulang.
  await page.goto('/antrean');
  await page
    .getByRole('navigation', { name: 'Layanan antrean' })
    .getByRole('link', { name: /^PD\s/ })
    .click();
  await page
    .getByRole('listitem', { name: `${poliNo} · Menunggu` })
    .getByRole('button', {
      name: `Panggil ${poliNo}`,
    })
    .click();
  await expect(tv.getByRole('region', { name: 'Sedang dipanggil' })).toContainText(poliNo, {
    timeout: 15_000,
  });
  await tvContext.close();

  // 5) Task 1–3 diterima Antrean BPJS mock (urut) dan berstatus `sent` di SIM RS; layar Pendaftaran ikut.
  await expect
    .poll(async () => (await mockAntrean(booking.bookingCode))?.tasks.map((t) => t.taskid), {
      timeout: 60_000,
    })
    .toEqual(expect.arrayContaining([1, 2, 3]));
  const received = (await mockAntrean(booking.bookingCode))?.tasks.map((t) => t.taskid) ?? [];
  expect(received.slice(0, 3)).toEqual([1, 2, 3]);
  await expect
    .poll(async () => (await bpjsTaskStatuses(booking.id)).filter((t) => t.taskId <= 3), { timeout: 60_000 })
    .toEqual([
      { taskId: 1, status: 'sent' },
      { taskId: 2, status: 'sent' },
      { taskId: 3, status: 'sent' },
    ]);
  await page.goto(`/pendaftaran?kunjungan=${encounterId}`);
  const tasks = page.getByRole('region', { name: 'Status SEP dan Antrean BPJS' }).getByRole('list', {
    name: 'Task ID 1–3',
  });
  await expect(tasks).toContainText('Task 1 · tunggu admisi: terkirim');
  await expect(tasks).toContainText('Task 2 · layan admisi: terkirim');
  await expect(tasks).toContainText('Task 3 · tunggu poli: terkirim');
});
