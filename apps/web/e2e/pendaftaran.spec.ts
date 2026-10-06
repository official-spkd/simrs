import { expect, test } from '@playwright/test';
import { isoDateJakarta, newId } from '@simrs/shared';
import { createAccount, createPatient, inTenant, loginAs, TENANTS } from './support/accounts';
import { activeBpjsCard, hfisSession, sepInsertAttempts, sepOf, setBpjsOutage } from './support/front-office';
import { ensureRsfaSchedule } from './support/schedule';

/**
 * F03/F06 · Layar Pendaftaran mode api (fase 2 potongan 5b): petugas mencari pasien JKN, cek kepesertaan, memilih
 * rujukan, dokter, dan persetujuan umum, lalu mendaftarkan saat BPJS terganggu untuk pasien itu (gangguan per kartu di
 * mock): kunjungan tetap tercatat
 * dengan SEP "menunggu BPJS", lalu terbit sendiri setelah mock pulih (DoD "gangguan BPJS"). Pasien baru lewat Dukcapil
 * + cek duplikat, penjamin umum, dan cetak tiket 80 mm. Data fiktif (NIK 9999…, kartu 0000…).
 */

const today = isoDateJakarta(new Date());
const digits = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');

/**
 * Sesi dr. Andini (poli PD) HARI INI dengan jam mulai acak 05.00–06.59, apa pun hari tes berjalan (templat mingguan bisa
 * libur hari ini). Jam yang sudah dipakai run sebelumnya di database tes yang sama dipakai ulang (kunci unik praktisi ×
 * tanggal × jam mulai), dengan kuota dilonggarkan.
 */
async function todaySession(): Promise<{ id: string; label: RegExp }> {
  const minute = String(Math.floor(Math.random() * 60)).padStart(2, '0');
  const hour = String(5 + Math.floor(Math.random() * 2)).padStart(2, '0');
  const id = await inTenant(TENANTS.RSFA, async (tx) => {
    const service = await tx.queueService.findFirstOrThrow({ where: { code: 'PD' } });
    const practitioner = await tx.practitioner.findFirstOrThrow({
      where: { name: 'dr. Andini Prameswari, Sp.PD' },
    });
    const where = {
      practitionerId: practitioner.id,
      sessionDate: new Date(`${today}T00:00:00.000Z`),
      startTime: new Date(`1970-01-01T${hour}:${minute}:00.000Z`),
    };
    const found = await tx.scheduleSession.findFirst({
      where,
      select: { id: true, bookedJkn: true, bookedNonJkn: true },
    });
    if (found) {
      await tx.scheduleSession.update({
        where: { id: found.id },
        data: { kind: 'praktik', quotaJkn: found.bookedJkn + 50, quotaNonJkn: found.bookedNonJkn + 50 },
      });
      return found.id;
    }
    const created = await tx.scheduleSession.create({
      data: {
        id: newId(),
        tenantId: TENANTS.RSFA,
        ...where,
        serviceId: service.id,
        endTime: new Date('1970-01-01T23:59:00.000Z'),
        quotaJkn: 50,
        quotaNonJkn: 50,
      },
    });
    return created.id;
  });
  return { id, label: new RegExp(`dr\\. Andini Prameswari, Sp\\.PD\\s*${hour}\\.${minute}–23\\.59`) };
}

test.beforeAll(async () => {
  await ensureRsfaSchedule();
});

test.describe('layar Pendaftaran mode api (/pendaftaran)', () => {
  // Gangguan BPJS hanya untuk kartu pasien tes ini (`POST /_panel/api/bpjs/outage`), bukan skenario global: spesifikasi
  // lain (rantai DoD, anjungan) memakai mock BPJS bersamaan. Tetap berurutan dan selalu dipulihkan.
  test.describe.configure({ mode: 'serial' });
  let outageCard: string | null = null;
  const bpjsDown = async (card: string, down: boolean) => {
    await setBpjsOutage(card, down);
    outageCard = down ? card : null;
  };
  test.afterEach(async () => {
    if (outageCard) await bpjsDown(outageCard, false);
  });

  test('pasien JKN: cari → cek kepesertaan → rujukan → daftar saat BPJS gagal → SEP menunggu → terbit setelah pulih', async ({
    page,
  }, info) => {
    test.skip(
      info.project.name !== 'desktop',
      'Satu proyek saja: gangguan BPJS per kartu dipulihkan di afterEach.',
    );
    test.setTimeout(150_000);
    // Hari Minggu tidak ada praktik PD di HFIS mock: alur SEP tetap diuji, task ID Antrean dilewati.
    const hfis = await hfisSession();
    const session = hfis ?? (await todaySession());
    const card = activeBpjsCard();
    const patient = await createPatient('RSFA', {
      name: 'Suryani Fiktif Daftar',
      sex: 'female',
      birthDate: '1972-03-14',
      // Antrean BPJS (`bpjs.antrean.add`) mewajibkan no. HP pasien.
      phone: `62812${digits(8)}`,
      identifiers: { nik: `99990101900${digits(5)}`, bpjs: card },
    });
    const loket = await createAccount({ roles: ['petugas_pendaftaran'] });
    await loginAs(page, loket, '/pendaftaran');
    await expect(
      page.getByRole('heading', { name: 'Pendaftaran pasien rawat jalan', level: 1 }),
    ).toBeVisible();

    // Cari dengan no. kartu: satu pasien cocok → langsung dibuka; no. kartu terisi untuk cek kepesertaan.
    await page.getByLabel('Cari pasien (NIK, No. RM, No. BPJS, atau nama)').fill(card);
    await page.getByRole('button', { name: 'Cari pasien' }).click();
    const ident = page.getByRole('region', { name: 'Identitas pasien' });
    await expect(ident).toContainText('Suryani Fiktif Daftar');
    await expect(ident).toContainText(patient.mrn);
    await expect(ident).not.toContainText(card);
    await expect(page.getByLabel('No. kartu BPJS atau NIK')).toHaveValue(card);

    await page.getByRole('button', { name: 'Cek kepesertaan' }).click();
    const elig = page.getByRole('definition').filter({ hasText: 'AKTIF' });
    await expect(elig).toBeVisible();
    const active = page.getByRole('button', { name: new RegExp(`Rujukan FKTP.*${card.slice(-9)}01`) });
    await expect(active).toBeEnabled();
    await expect(page.getByRole('button', { name: new RegExp(`${card.slice(-9)}99`) })).toBeDisabled();
    await active.click();
    await expect(active).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByLabel(/Diagnosa awal \(ICD-10\)/)).toHaveValue(/^I10 · /);

    await page.getByRole('button', { name: session.label }).click();
    await page.getByLabel(/Persetujuan umum sudah ditandatangani/).check();
    const submit = page.getByRole('button', { name: 'Daftarkan dan terbitkan SEP' });
    await expect(submit).toBeEnabled();

    // BPJS terganggu tepat saat pendaftaran: kunjungan tetap tercatat, SEP menunggu.
    await bpjsDown(card, true);
    await submit.click();
    await expect(page).toHaveURL(/\/pendaftaran\?kunjungan=[0-9a-f-]{36}$/);
    await expect(
      page.getByRole('heading', { name: 'Pendaftaran rawat jalan selesai', level: 1 }),
    ).toBeVisible();
    await expect(page.getByText(/^Terdaftar pukul \d{2}\.\d{2} · RJ-\d{4}-\d{6}$/)).toBeVisible();
    await expect(page.getByText(/^PD-\d{3}$/)).toBeVisible();
    const status = page.getByRole('region', { name: 'Status SEP dan Antrean BPJS' });
    await expect(status.getByText('SEP menunggu BPJS')).toBeVisible();
    await expect(status).toContainText('Pasien tetap boleh ke poli');
    const encounterId = new URL(page.url()).searchParams.get('kunjungan') ?? '';
    const sep = await sepOf(encounterId);
    expect(sep?.status).toBe('pending');
    // Worker sudah mencoba dan gagal (mock 503) → SEP tetap pending, dicoba ulang otomatis.
    await expect.poll(() => sepInsertAttempts(sep?.id ?? ''), { timeout: 20_000 }).toBeGreaterThan(0);
    expect((await sepOf(encounterId))?.status).toBe('pending');

    // BPJS pulih: SEP terbit tanpa tindakan petugas, layar memperbarui sendiri.
    await bpjsDown(card, false);
    await expect(status.getByText('SEP terbit')).toBeVisible({ timeout: 60_000 });
    const issued = await sepOf(encounterId);
    expect(issued?.status).toBe('issued');
    await expect(status).toContainText(issued?.sepNo ?? '—');
    const tasks = status.getByRole('list', { name: 'Task ID 1–3' });
    if (hfis) {
      // Tambah antrean + task 1–3 (walk-in tanpa panggilan loket: task 2 = saat didaftarkan) terkirim setelah pulih.
      await expect(tasks).toContainText('Task 1 · tunggu admisi: terkirim', { timeout: 60_000 });
      await expect(tasks).toContainText('Task 2 · layan admisi: terkirim', { timeout: 60_000 });
      await expect(tasks).toContainText('Task 3 · tunggu poli: terkirim', { timeout: 60_000 });
    } else {
      await expect(tasks).toBeVisible();
    }

    // Cetak tiket + SEP (HTML 80 mm) di tab baru; pembukaan dicatat audit `print`.
    const popup = page.waitForEvent('popup');
    await page.getByRole('link', { name: 'Cetak tiket dan SEP' }).click();
    const slip = await popup;
    const ticket = slip.getByRole('article', { name: 'Tiket pendaftaran' });
    await expect(ticket).toContainText('Suryani Fiktif Daftar');
    await expect(ticket).toContainText('SURAT ELIGIBILITAS PESERTA');
    await expect(ticket).toContainText(issued?.sepNo ?? '—');
    await expect(ticket).not.toContainText(card);
    const printed = await inTenant(TENANTS.RSFA, (tx) =>
      tx.auditEvent.count({ where: { resourceId: encounterId, action: 'print' } }),
    );
    expect(printed).toBeGreaterThan(0);
  });

  test('VClaim mati saat cek → rujukan manual → SEP ditolak BPJS tampil dengan alasan → kirim ulang', async ({
    page,
  }, info) => {
    test.skip(
      info.project.name !== 'desktop',
      'Satu proyek saja: gangguan BPJS per kartu dipulihkan di afterEach.',
    );
    test.setTimeout(120_000);
    const session = await todaySession();
    // Kartu berakhiran 0000 = peserta tidak aktif di mock: worker menolak SEP di tahap cek peserta.
    const card = `0000${digits(5)}0000`;
    await createPatient('RSFA', {
      name: 'Peserta Nonaktif Fiktif',
      sex: 'male',
      birthDate: '1966-07-21',
      phone: `62812${digits(8)}`,
      identifiers: { nik: `99992107660${digits(5)}`, bpjs: card },
    });
    const loket = await createAccount({ roles: ['petugas_pendaftaran'] });
    await loginAs(page, loket, '/pendaftaran');
    await page.getByLabel('Cari pasien (NIK, No. RM, No. BPJS, atau nama)').fill(card);
    await page.getByRole('button', { name: 'Cari pasien' }).click();
    await expect(page.getByRole('region', { name: 'Identitas pasien' })).toContainText(
      'Peserta Nonaktif Fiktif',
    );

    // VClaim tidak terjangkau: pendaftaran tetap bisa lanjut dengan nomor rujukan dari dokumen pasien.
    await bpjsDown(card, true);
    await page.getByRole('button', { name: 'Cek kepesertaan' }).click();
    await expect(page.getByText('VClaim tidak terjangkau')).toBeVisible();
    await expect(page.getByLabel('Isi nomor rujukan / surat kontrol manual')).toBeChecked();
    await page.getByLabel('No. rujukan / surat kontrol').fill(`9999P001${card.slice(-9)}01`);
    await page.getByLabel(/Diagnosa awal \(ICD-10\)/).fill('I10 · Hipertensi esensial (primer)');
    await page.getByRole('button', { name: session.label }).click();
    await page.getByLabel(/Persetujuan umum sudah ditandatangani/).check();
    await page.getByRole('button', { name: 'Daftarkan dan terbitkan SEP' }).click();
    await expect(
      page.getByRole('heading', { name: 'Pendaftaran rawat jalan selesai', level: 1 }),
    ).toBeVisible();
    const status = page.getByRole('region', { name: 'Status SEP dan Antrean BPJS' });
    await expect(status.getByText('SEP menunggu BPJS')).toBeVisible();

    // BPJS pulih → worker menolak (peserta tidak aktif): status gagal + alasan + kode, tombol kirim ulang.
    await bpjsDown(card, false);
    await expect(status.getByText('SEP ditolak BPJS')).toBeVisible({ timeout: 60_000 });
    await expect(status).toContainText('BPJS_PESERTA_TIDAK_AKTIF');
    const encounterId = new URL(page.url()).searchParams.get('kunjungan') ?? '';
    const failed = await sepOf(encounterId);
    expect(failed?.status).toBe('failed');
    await status.getByRole('button', { name: 'Kirim ulang SEP' }).click();
    await expect(page.getByText(/^SEP dikirim ulang ke BPJS/)).toBeVisible();
    // Kirim ulang tercatat (urut pesan berikutnya) dan ditolak lagi karena kepesertaan belum aktif.
    await expect
      .poll(
        () =>
          inTenant(TENANTS.RSFA, (tx) =>
            tx.outboxMessage.count({
              where: { operation: 'bpjs.vclaim.sep.insert', idempotencyKey: { contains: failed?.id ?? '-' } },
            }),
          ),
        { timeout: 20_000 },
      )
      .toBe(2);
    await expect(status.getByText('SEP ditolak BPJS')).toBeVisible({ timeout: 60_000 });
  });

  test('pasien baru: Dukcapil → cek duplikat → penjamin umum → daftar → cetak tiket', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'desktop', 'Satu proyek saja: sesi uji dibuat per tes.');
    test.setTimeout(90_000);
    const session = await todaySession();
    // Pasien yang sudah ada dengan NIK yang sama → cek duplikat menawarkannya.
    const nik = `99991203850${digits(5)}`;
    const existing = await createPatient('RSFA', {
      name: 'Pasien Lama Fiktif',
      sex: 'female',
      birthDate: '1985-12-03',
      identifiers: { nik },
    });
    const loket = await createAccount({ roles: ['petugas_pendaftaran'] });
    await loginAs(page, loket, '/pendaftaran');

    await page.getByRole('button', { name: 'Pasien baru' }).click();
    const form = page.getByRole('region', { name: 'Pasien baru' });
    await form.getByLabel('NIK').fill(nik);
    await form.getByRole('button', { name: 'Ambil data Dukcapil' }).click();
    await expect(form.getByText('Terisi dari Dukcapil')).toBeVisible();
    await expect(form.getByLabel('Nama lengkap (sesuai KTP)')).not.toHaveValue('');
    await form.getByRole('button', { name: 'Periksa duplikat dan simpan pasien' }).click();
    const dupes = form.getByRole('list', { name: 'Kemungkinan duplikat' });
    await expect(dupes).toContainText(existing.mrn);
    await dupes
      .getByRole('listitem')
      .filter({ hasText: existing.mrn })
      .getByRole('button', { name: 'Pakai pasien ini' })
      .click();
    const ident = page.getByRole('region', { name: 'Identitas pasien' });
    await expect(ident).toContainText('Pasien Lama Fiktif');
    await expect(ident).toContainText(existing.mrn);

    // Tanpa no. kartu BPJS → penjamin umum; penanggung jawab baru; persetujuan umum oleh wali.
    await expect(page.getByRole('heading', { name: 'Penjamin: Umum (bayar sendiri)' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'BPJS', exact: true })).toBeDisabled();
    await page.getByLabel('Tambah penanggung jawab baru').check();
    await page.getByLabel('Nama penanggung jawab').fill('Budi Fiktif');
    await page.getByRole('button', { name: session.label }).click();
    await page.getByLabel(/Persetujuan umum sudah ditandatangani/).check();
    await page.getByLabel('Ditandatangani oleh').selectOption('wali');
    await expect(page.getByRole('button', { name: 'Daftarkan', exact: true })).toBeDisabled();
    await page.getByLabel('Nama wali').fill('Budi Fiktif');
    await page.getByRole('button', { name: 'Daftarkan', exact: true }).click();

    await expect(
      page.getByRole('heading', { name: 'Pendaftaran rawat jalan selesai', level: 1 }),
    ).toBeVisible();
    await expect(page.getByText('Penjamin bukan BPJS · tanpa SEP.')).toBeVisible();
    const encounterId = new URL(page.url()).searchParams.get('kunjungan') ?? '';
    const contacts = await inTenant(TENANTS.RSFA, (tx) =>
      tx.patientContact.count({ where: { patientId: existing.id } }),
    );
    expect(contacts).toBe(1);

    await page.goto(`/cetak/pendaftaran/${encounterId}`);
    const ticket = page.getByRole('article', { name: 'Tiket pendaftaran' });
    await expect(ticket).toContainText(existing.mrn);
    await expect(ticket).toContainText(/PD-\d{3}/);
    await expect(ticket).not.toContainText('SURAT ELIGIBILITAS PESERTA');

    // Pasien berikutnya: kembali ke meja kosong; persetujuan umum kini sudah berlaku untuk pasien ini.
    await page.goto('/pendaftaran');
    await page.getByLabel('Cari pasien (NIK, No. RM, No. BPJS, atau nama)').fill(existing.mrn);
    await page.getByRole('button', { name: 'Cari pasien' }).click();
    await page
      .getByRole('button', { name: new RegExp(`Pilih Pasien Lama Fiktif, RM ${existing.mrn}`) })
      .click();
    await expect(page.getByText('Persetujuan umum rawat jalan berlaku')).toBeVisible();
  });
});
