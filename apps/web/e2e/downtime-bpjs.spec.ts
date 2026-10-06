import { expect, test } from '@playwright/test';
import { isoDateJakarta, newId } from '@simrs/shared';
import { createAccount, createPatient, inTenant, loginAs, TENANTS } from './support/accounts';
import { useTestDevice } from './support/devices';
import {
  activeBpjsCard,
  createJknBooking,
  hfisSession,
  mockAntrean,
  mockSep,
  rujukanNo,
  sepInsertAttempts,
  sepOf,
  setBpjsOutage,
} from './support/front-office';
import { ensureRsfaSchedule } from './support/schedule';

/**
 * Downtime BPJS (fase 2 potongan 9, DoD "gangguan mock BPJS tidak menghentikan pendaftaran"): BPJS mati untuk pasien
 * ini saja (gangguan per peserta di mock, `setBpjsOutage`) sehingga tes lain yang memakai sistem `bpjs` bersama tidak
 * terganggu. Pasien JKN mendaftar sendiri di anjungan saat BPJS mati: nomor poli tetap terbit, SEP "menunggu BPJS"
 * terlihat di layar Pendaftaran dan dicoba ulang worker, lalu terbit sendiri setelah BPJS pulih. Serial, hanya
 * proyek desktop (`testIgnore` di proyek tablet), gangguan selalu dicabut di `afterEach`. Data fiktif.
 */

const digits = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');
/** Diagnosa awal fiktif dari fixture registrasi 5a (`apps/api/test/registration.test.ts`), tidak dikarang. */
const DIAG = { code: 'I10', display: 'Hipertensi esensial (primer)' };

test.describe.configure({ mode: 'serial' });

/** Kartu yang sedang dibuat "mati" oleh tes ini (dicabut di afterEach walau tes gagal). */
let outageCard: string | null = null;

test.beforeAll(async () => {
  await ensureRsfaSchedule();
});

test.afterEach(async () => {
  if (outageCard) await setBpjsOutage(outageCard, false);
  outageCard = null;
});

test('BPJS mati: daftar mandiri di anjungan tetap jalan, SEP menunggu terlihat, terbit setelah pulih', async ({
  page,
  browser,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'Satu proyek saja: anjungan uji dipakai bersama.');
  test.setTimeout(180_000);
  const session = await hfisSession();
  test.skip(!session, 'Hari Minggu: tidak ada praktik poli PD di HFIS mock, Antrean BPJS menolak booking.');
  if (!session) return;

  const card = activeBpjsCard();
  const patient = await createPatient('RSFA', {
    name: 'Ratna Kusuma Fiktif',
    sex: 'female',
    birthDate: '1979-04-09',
    phone: `62812${digits(8)}`,
    identifiers: { nik: `99990904790${digits(5)}`, bpjs: card },
  });
  const loket = await createAccount({ roles: ['petugas_pendaftaran'] });
  await loginAs(page, loket, '/antrean');
  const booking = await createJknBooking(page.context(), {
    patientId: patient.id,
    sessionId: session.id,
    referenceNumber: rujukanNo(card),
  });
  await expect.poll(() => mockAntrean(booking.bookingCode), { timeout: 30_000 }).not.toBeNull();
  // Rujukan FKTP sudah tercatat (hasil cek VClaim sebelumnya) dan persetujuan umum rawat jalan sudah ada: syarat daftar
  // mandiri di anjungan.
  await inTenant(TENANTS.RSFA, async (tx) => {
    await tx.referral.create({
      data: {
        id: newId(),
        tenantId: TENANTS.RSFA,
        patientId: patient.id,
        kind: 'rujukan-fktp',
        number: rujukanNo(card),
        facilityName: 'FKTP Fiktif',
        diagnosisCode: DIAG.code,
        diagnosisDisplay: DIAG.display,
        issuedOn: new Date(`${isoDateJakarta()}T00:00:00.000Z`),
        status: 'active',
      },
    });
    await tx.privacyConsent.create({
      data: {
        id: newId(),
        tenantId: TENANTS.RSFA,
        patientId: patient.id,
        kind: 'umum',
        note: 'Persetujuan uji',
      },
    });
  });

  // BPJS mati untuk peserta ini.
  outageCard = card;
  await setBpjsOutage(card, true);

  const kioskContext = await browser.newContext();
  await useTestDevice(kioskContext, 'kiosk');
  const kiosk = await kioskContext.newPage();
  await kiosk.goto('/kiosk');
  await kiosk.getByRole('button', { name: /Pasien BPJS/ }).click();
  await kiosk.getByRole('button', { name: /Nomor kartu BPJS/ }).click();
  const keypad = kiosk.getByRole('group', { name: 'Keypad angka' });
  for (const d of card) await keypad.getByRole('button', { name: `Angka ${d}` }).click();
  await kiosk.getByRole('button', { name: 'Lanjut' }).click();
  // Faktor kedua: tanggal + bulan lahir (DDMM) sebelum nama tersamar tampil.
  await expect(kiosk.getByRole('heading', { name: 'Masukkan tanggal dan bulan lahir' })).toBeVisible();
  for (const d of '0904') await keypad.getByRole('button', { name: `Angka ${d}` }).click();
  await kiosk.getByRole('button', { name: 'Lanjut' }).click();
  await kiosk.getByRole('button', { name: 'Ya, data saya benar · daftar ke poli' }).click();
  const slip = kiosk.getByRole('region', { name: 'Tiket antrean' });
  await expect(slip).toContainText(/PD-\d{3}/);
  await expect(slip).toContainText('Pendaftaran berhasil');
  await kioskContext.close();

  const encounter = await inTenant(TENANTS.RSFA, (tx) =>
    tx.encounter.findFirstOrThrow({ where: { patientId: patient.id }, select: { id: true } }),
  );
  const sep = await sepOf(encounter.id);
  expect(sep?.status).toBe('pending');
  // Worker sudah mencoba dan ditolak mock (503) → tetap pending, dicoba ulang otomatis.
  await expect.poll(() => sepInsertAttempts(sep?.id ?? ''), { timeout: 30_000 }).toBeGreaterThan(0);
  expect((await sepOf(encounter.id))?.status).toBe('pending');

  // Petugas melihat statusnya di layar Pendaftaran: SEP menunggu, pasien tetap boleh ke poli.
  await page.goto(`/pendaftaran?kunjungan=${encounter.id}`);
  const status = page.getByRole('region', { name: 'Status SEP dan Antrean BPJS' });
  await expect(status.getByText('SEP menunggu BPJS')).toBeVisible();
  await expect(status).toContainText('Pasien tetap boleh ke poli');

  // BPJS pulih → SEP terbit tanpa tindakan petugas; layar memperbarui sendiri.
  await setBpjsOutage(card, false);
  outageCard = null;
  await expect(status.getByText('SEP terbit')).toBeVisible({ timeout: 90_000 });
  const issued = await sepOf(encounter.id);
  expect(issued?.status).toBe('issued');
  expect(await mockSep(issued?.sepNo ?? '-')).toMatchObject({ noKartu: card });
});
