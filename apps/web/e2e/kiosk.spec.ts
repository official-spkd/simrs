import { expect, type Page, test } from '@playwright/test';
import { toDbDate } from '@simrs/db';
import { isoDateJakarta, newId } from '@simrs/shared';
import { createAccount, createPatient, inTenant, loginAs, TENANTS } from './support/accounts';
import { useTestDevice } from './support/devices';
import { ensureRsfaSchedule } from './support/schedule';

/**
 * F05 · Anjungan mode api (fase 2 potongan 6): PERANGKAT anjungan terdaftar (bukan akun staf) mengenali pasien dari
 * NIK dengan nama tersamar + tanggal lahir tanpa tahun, check-in booking hari ini, dan mencetak nomor loket A-xxx yang
 * langsung tampil di Kendali antrean petugas.
 */

const digits = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');

/** Sesi poli PD hari ini milik dokter uji sendiri (nama unik per jalan agar mudah dipilih di anjungan). */
async function sessionToday(doctorName: string) {
  const today = isoDateJakarta();
  return inTenant(TENANTS.RSFA, async (tx) => {
    const service = await tx.queueService.findFirstOrThrow({ where: { code: 'PD' }, select: { id: true } });
    const practitionerId = newId();
    await tx.practitioner.create({ data: { id: practitionerId, tenantId: TENANTS.RSFA, name: doctorName } });
    const sessionId = newId();
    await tx.scheduleSession.create({
      data: {
        id: sessionId,
        tenantId: TENANTS.RSFA,
        practitionerId,
        serviceId: service.id,
        sessionDate: toDbDate(today),
        startTime: new Date('1970-01-01T00:00:00Z'),
        endTime: new Date('1970-01-01T23:59:00Z'),
        quotaJkn: 10,
        quotaNonJkn: 2,
      },
    });
    return { serviceId: service.id, practitionerId, sessionId };
  });
}

/** Pasien fiktif (NIK 9999…) dengan booking JKN hari ini di poli PD, sesi milik dokter uji sendiri. */
async function patientWithBookingToday() {
  const nik = `9999${digits(12)}`;
  const patient = await createPatient('RSFA', {
    name: 'Siti Rahmawati',
    birthDate: '1985-03-14',
    identifiers: { nik },
  });
  const today = isoDateJakarta();
  const { serviceId, practitionerId, sessionId } = await sessionToday('dr. Uji Anjungan, Sp.PD');
  await inTenant(TENANTS.RSFA, async (tx) => {
    await tx.appointment.create({
      data: {
        id: newId(),
        tenantId: TENANTS.RSFA,
        bookingCode: `9${digits(9)}`,
        patientId: patient.id,
        sessionId,
        practitionerId,
        serviceId,
        appointmentDate: toDbDate(today),
        quotaBucket: 'jkn',
        channel: 'mobile_jkn',
        jknVisitKind: 3,
        referenceNumber: '9999R0011025K000001',
      },
    });
  });
  return { nik };
}

async function typeDigits(page: Page, value: string) {
  const keypad = page.getByRole('group', { name: 'Keypad angka' });
  for (const d of value) await keypad.getByRole('button', { name: `Angka ${d}` }).click();
}

test.beforeAll(async () => {
  await ensureRsfaSchedule();
});

test.describe('anjungan mandiri (perangkat terdaftar)', () => {
  test('check-in booking dari anjungan → nomor A-xxx tampil di Kendali antrean', async ({
    page,
    browser,
  }, info) => {
    test.skip(
      info.project.name !== 'desktop',
      'Satu proyek saja: anjungan uji dan antrean loket RSFA dipakai bersama.',
    );
    test.setTimeout(90_000);
    const { nik } = await patientWithBookingToday();

    const kioskContext = await browser.newContext();
    await useTestDevice(kioskContext, 'kiosk');
    const kiosk = await kioskContext.newPage();
    await kiosk.goto('/kiosk');
    await expect(kiosk.getByRole('heading', { level: 1 })).toContainText('Apa yang ingin Anda lakukan?');
    await kiosk.getByRole('button', { name: /Saya sudah punya booking/ }).click();
    await kiosk.getByRole('button', { name: /NIK e-KTP/ }).click();
    await typeDigits(kiosk, nik);
    await kiosk.getByRole('button', { name: 'Lanjut' }).click();

    // Konfirmasi: hanya nama tersamar + tanggal lahir tanpa tahun (tanpa RM/NIK).
    const data = kiosk.getByRole('region', { name: 'Data pasien' });
    await expect(data.getByTestId('nama-tersamar')).toHaveText('Si•• Ra•••••••');
    await expect(data).toContainText('Tanggal lahir 14 Mar');
    await expect(data).not.toContainText('Rahmawati');
    await expect(kiosk.getByText(nik)).toHaveCount(0);
    await kiosk.getByRole('button', { name: 'Ya, data saya benar · check-in' }).click();

    const ticket = kiosk.getByRole('region', { name: 'Tiket antrean' });
    await expect(ticket).toContainText('Loket Pendaftaran');
    const queueNo = /A-\d{3}/.exec((await ticket.textContent()) ?? '')?.[0] ?? '';
    expect(queueNo).not.toBe('');

    // Petugas pendaftaran: nomor anjungan menunggu di layanan loket A.
    const loket = await createAccount({ roles: ['petugas_pendaftaran'] });
    await loginAs(page, loket, '/antrean');
    await page
      .getByRole('navigation', { name: 'Layanan antrean' })
      .getByRole('link', { name: /^A\s/ })
      .click();
    await expect(page.getByRole('listitem', { name: `${queueNo} · Menunggu` })).toBeVisible();

    // Selesai → anjungan kembali ke layar awal (tidak ada data pasien tertinggal).
    await kiosk.getByRole('button', { name: 'Selesai' }).click();
    await expect(kiosk.getByRole('heading', { level: 1 })).toContainText('Apa yang ingin Anda lakukan?');
    await kioskContext.close();
  });

  test('pasien umum: pilih dokter di anjungan → terdaftar (alur 5a) dengan nomor poli PD-xxx', async ({
    browser,
  }, info) => {
    test.skip(
      info.project.name !== 'desktop',
      'Satu proyek saja: anjungan uji dan antrean poli RSFA dipakai bersama.',
    );
    const doctor = `dr. Uji Anjungan ${digits(4)}, Sp.PD`;
    await sessionToday(doctor);
    const nik = `9999${digits(12)}`;
    const patient = await createPatient('RSFA', {
      name: 'Dewi Lestari',
      birthDate: '1992-07-21',
      identifiers: { nik },
    });
    // Persetujuan umum rawat jalan sudah ditandatangani di kunjungan sebelumnya (anjungan tidak memintanya).
    await inTenant(TENANTS.RSFA, (tx) =>
      tx.privacyConsent.create({
        data: {
          id: newId(),
          tenantId: TENANTS.RSFA,
          patientId: patient.id,
          kind: 'umum',
          note: 'Persetujuan uji',
        },
      }),
    );

    const kioskContext = await browser.newContext();
    await useTestDevice(kioskContext, 'kiosk');
    const kiosk = await kioskContext.newPage();
    await kiosk.goto('/kiosk');
    await kiosk.getByRole('button', { name: /Pasien umum atau asuransi/ }).click();
    await kiosk.getByRole('button', { name: /NIK e-KTP/ }).click();
    await typeDigits(kiosk, nik);
    await kiosk.getByRole('button', { name: 'Lanjut' }).click();
    await expect(kiosk.getByTestId('nama-tersamar')).toHaveText('De•• Le•••••');
    await kiosk.getByRole('button', { name: 'Ya, data saya benar · pilih dokter' }).click();
    await kiosk.getByRole('listitem', { name: new RegExp(`^${doctor.replace(/[.,]/g, '.')}`) }).click();

    const ticket = kiosk.getByRole('region', { name: 'Tiket antrean' });
    await expect(ticket).toContainText(/PD-\d{3}/);
    await expect(ticket).toContainText('Pendaftaran berhasil');
    const encounters = await inTenant(TENANTS.RSFA, (tx) =>
      tx.encounter.count({ where: { patientId: patient.id } }),
    );
    expect(encounters).toBe(1);
    await kioskContext.close();
  });

  test('NIK tidak dikenal → tawaran nomor antrean loket tanpa identitas', async ({ browser }, info) => {
    test.skip(info.project.name !== 'desktop', 'Satu proyek saja: anjungan uji dipakai bersama.');
    const kioskContext = await browser.newContext();
    await useTestDevice(kioskContext, 'kiosk');
    const kiosk = await kioskContext.newPage();
    await kiosk.goto('/kiosk');
    await kiosk.getByRole('button', { name: /Pasien umum atau asuransi/ }).click();
    await kiosk.getByRole('button', { name: /NIK e-KTP/ }).click();
    await typeDigits(kiosk, `9999${digits(12)}`);
    await kiosk.getByRole('button', { name: 'Lanjut' }).click();
    await expect(kiosk.getByText('Data tidak ditemukan', { exact: false })).toBeVisible();
    await kiosk.getByRole('button', { name: 'Ambil nomor antrean loket pendaftaran' }).click();
    await expect(kiosk.getByRole('region', { name: 'Tiket antrean' })).toContainText(/A-\d{3}/);
    await kioskContext.close();
  });
});
