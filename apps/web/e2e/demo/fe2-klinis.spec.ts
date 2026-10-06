import { expect, type Locator, type Page, test } from '@playwright/test';
import { type Account, createAccount, loginAs, submitPassword, totpFor, typeCode } from '../support/accounts';
import { ENCOUNTER_ID } from '../../src/lib/demo/fixtures/ids';

/**
 * FE2 · Layar rekam medis elektronik fase 3 (mode presentasi, ADR-0023): worklist (K01), CPPT + co-sign + serah
 * terima (K07), asesmen (K06), diagnosis (K08), konsultasi (K10), edukasi (K11), askep + gerbang gelang eMAR (K12),
 * ringkasan (K14), paket layanan (K15), kelengkapan rekam medis + gerbang tutup kunjungan (K13).
 */

async function openAs(page: Page, roles: string[], path: string) {
  const account = await createAccount({ roles });
  await loginAs(page, account, path);
  await page.goto(path);
  return account;
}

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

const card = (page: Page, title: RegExp | string): Locator => page.getByRole('article', { name: title });
const JAM = '\\d{2}\\.\\d{2}';

test.describe('K01 · worklist klinis', () => {
  test('DPJP: nilai kritis wajib dibaca ulang; co-sign residen; konsul lewat batas', async ({ page }) => {
    await openAs(page, ['dokter'], '/klinis/worklist');
    await expect(page.getByRole('heading', { level: 1, name: /^Worklist klinis · / })).toBeVisible();
    await expect(page.getByRole('tab', { name: /Tugas tertunda/ })).toHaveAttribute('aria-selected', 'true');

    const kritis = card(page, /Kalium 6,4 mmol\/L \(kritis\)/);
    await expect(kritis.getByText('Kritis', { exact: true })).toBeVisible();
    await kritis.getByRole('button', { name: 'Terima nilai kritis' }).click();
    const save = kritis.getByRole('button', { name: 'Simpan penerimaan' });
    await expect(save).toBeDisabled();
    await kritis.getByLabel('Nilai dibaca ulang (mmol/L)').fill('4,6');
    await kritis.getByLabel('Tindak lanjut').selectOption('Tata laksana sesuai protokol hiperkalemia');
    await save.click();
    await expect(kritis.getByText('Nilai tidak cocok dengan laporan lab.', { exact: false })).toBeVisible();
    await kritis.getByLabel('Nilai dibaca ulang (mmol/L)').fill('6,4');
    await save.click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Diterima dan dibaca ulang: 6,4 mmol/L' }),
    ).toHaveText(
      new RegExp(`tindak lanjut: Tata laksana sesuai protokol hiperkalemia · ${JAM} · Tn\\. Yusuf Hidayat`),
    );
    await expect(card(page, /Kalium 6,4/)).toHaveCount(0);

    const konsul = card(page, /Konsul cito dari dr\. Melati/);
    await expect(konsul.getByText(/^Lewat \d+ mnt$/)).toBeVisible();

    await card(page, /CPPT residen 07\.40/)
      .getByRole('button', { name: 'Co-sign sekarang' })
      .click();
    await expect(page.getByRole('status').filter({ hasText: 'Co-sign DPJP' })).toContainText(
      'Co-sign DPJP · CPPT residen final',
    );
    await page.getByRole('tab', { name: /Selesai/ }).click();
    await expect(page.getByText(new RegExp(`✓ Co-sign DPJP · CPPT residen final · ${JAM}`))).toBeVisible();

    await page.getByRole('tab', { name: /Pasien saya/ }).click();
    const mine = page.getByRole('region', { name: 'Pasien saya' });
    await expect(mine.getByRole('link', { name: 'Ny. Endang Wijaya' })).toBeVisible();
    await expect(mine.getByText('Pulang hari ini')).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test('residen: CPPT menunggu co-sign tidak bisa difinalkan sendiri', async ({ page }) => {
    await openAs(page, ['dokter_residen'], '/klinis/worklist');
    const waiting = card(page, /CPPT Anda 07\.40 menunggu co-sign DPJP/);
    await expect(waiting).toContainText('Residen tidak dapat memfinalkan CPPT sendiri');
    await expect(waiting.getByRole('button')).toHaveCount(0);
    await card(page, /Gula darah sewaktu 236/)
      .getByRole('button', { name: 'Tandai sudah dibaca' })
      .click();
    await expect(page.getByRole('status').filter({ hasText: 'Hasil dibaca' })).toBeVisible();
  });
});

const banner = (page: Page) => page.locator('[aria-label="Identitas pasien"]');
const notes = (page: Page) => page.getByRole('list', { name: 'Catatan CPPT' });
const note = (page: Page, text: string) => notes(page).getByRole('listitem').filter({ hasText: text });

test.describe('K07 · CPPT, co-sign, serah terima', () => {
  test('residen: catatan baru belum final sampai co-sign; singkatan terlarang diperingatkan', async ({
    page,
  }) => {
    await openAs(page, ['dokter_residen'], '/klinis/cppt');
    await expect(
      page.getByRole('heading', { level: 1, name: 'CPPT & serah terima · Ny. Endang Wijaya' }),
    ).toBeVisible();
    await expect(banner(page).getByText('Alergi: Amoksisilin')).toBeVisible();
    await page.getByRole('button', { name: '+ Tulis CPPT (SOAP)' }).click();
    const form = page.getByRole('form', { name: 'Tulis CPPT baru' });
    await expect(form.getByRole('note')).toContainText('Residen tidak dapat memfinalkan catatannya sendiri');
    await form.getByLabel('S · Subjektif').fill('Mual berkurang, nafsu makan membaik.');
    await form.getByLabel('A · Asesmen').fill('Hiperglikemia membaik.');
    await form.getByLabel('P · Rencana').fill('Insulin aspart 6 U sebelum makan siang.');
    await expect(form.getByText('Singkatan terlarang (peringatan, tidak memblokir):')).toBeVisible();
    await form.getByRole('button', { name: 'Simpan dan ajukan co-sign DPJP' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'menunggu co-sign DPJP' })).toHaveText(
      new RegExp(`Tersimpan · ${JAM} · belum final, menunggu co-sign DPJP`),
    );
    const mine = note(page, 'Hiperglikemia membaik.');
    await expect(mine.getByText('Belum final · menunggu co-sign DPJP')).toBeVisible();
    await expect(mine.getByRole('button', { name: 'Co-sign DPJP' })).toBeDisabled();
    await expect(mine.getByText('Hanya DPJP (posisi dokter) yang dapat co-sign.')).toBeVisible();
  });

  test('DPJP: co-sign residen, verifikasi PPA lain, riwayat versi, koreksi beralasan', async ({ page }) => {
    await openAs(page, ['dokter'], '/klinis/cppt');
    const residen = note(page, 'Pneumonia komunitas perbaikan; DM hiperglikemia.');
    await expect(residen.getByText('Belum final · menunggu co-sign DPJP')).toBeVisible();
    await residen.getByRole('button', { name: 'Co-sign DPJP' }).click();
    await expect(residen.getByText(new RegExp(`^Final · co-sign DPJP .+ · ${JAM}$`))).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Co-sign DPJP' })).toContainText('kini final');

    const farmasi = note(page, 'Usul evaluasi de-eskalasi');
    await expect(farmasi.getByText('Final · menunggu verifikasi DPJP (batas 6 Okt · 08.15)')).toBeVisible();
    await farmasi.getByRole('button', { name: 'Verifikasi DPJP' }).click();
    await expect(farmasi.getByText(new RegExp(`^Final · diverifikasi DPJP .+ · ${JAM}$`))).toBeVisible();

    const koreksi = note(page, 'SpO2 96% udara bebas, RR 20.');
    await expect(
      koreksi.getByText('Versi 2 · koreksi: Salah ketik nilai SpO2', { exact: false }),
    ).toBeVisible();
    await koreksi.getByRole('button', { name: 'Riwayat versi (2)' }).click();
    await expect(koreksi.getByText(/Versi 1 · .+ · digantikan/)).toBeVisible();

    await page.getByRole('button', { name: '+ Tulis CPPT (SOAP)' }).click();
    const form = page.getByRole('form', { name: 'Tulis CPPT baru' });
    await form.getByLabel('S · Subjektif').fill('Tidak ada keluhan baru.');
    await form.getByLabel('A · Asesmen').fill('Siap pulang hari ini.');
    await form.getByRole('button', { name: 'Simpan dan tanda tangani (final)' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Final · ditandatangani' })).toBeVisible();
    await note(page, 'Siap pulang hari ini.')
      .getByRole('button', { name: /^Koreksi CPPT/ })
      .click();
    const fix = page.getByRole('form', { name: 'Koreksi CPPT' });
    await fix.getByLabel('A · Asesmen').fill('Siap pulang hari ini setelah resume ditandatangani.');
    await fix.getByLabel('Alasan koreksi').fill('kurang');
    await fix.getByRole('button', { name: 'Simpan koreksi (versi baru)' }).click();
    await expect(fix.getByText('Wajib minimal 10 karakter · 4 karakter lagi.')).toBeVisible();
    await fix.getByLabel('Alasan koreksi').fill('Melengkapi syarat pulang');
    await fix.getByRole('button', { name: 'Simpan koreksi (versi baru)' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Koreksi tersimpan' })).toContainText('versi 2');
    await expect(
      note(page, 'setelah resume ditandatangani').getByText('Versi 2 · koreksi: Melengkapi syarat pulang'),
    ).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test('perawat: serah terima SBAR wajib penerima, lalu dikonfirmasi penerima', async ({ page }) => {
    await openAs(page, ['perawat'], '/klinis/cppt');
    const panel = page.getByRole('region', { name: 'Serah terima SBAR' });
    await expect(panel.getByText(/Malam → pagi · diserahkan Ns\. Yudi Pratama/)).toBeVisible();
    await expect(panel.getByText(/^Diterima .+ · 07\.06$/)).toBeVisible();
    await expect(panel.getByLabel('R · Rekomendasi')).not.toBeEmpty();
    await panel.getByRole('button', { name: 'Serahkan shift' }).click();
    await expect(panel.getByRole('alert')).toHaveText('Pilih perawat penerima shift berikutnya.');
    await panel.getByLabel('Penerima shift berikutnya').selectOption('Ns. Rosa Elvira, S.Kep');
    await panel.getByRole('button', { name: 'Serahkan shift' }).click();
    await expect(
      panel.getByText('Menunggu konfirmasi Ns. Rosa Elvira, S.Kep', { exact: true }),
    ).toBeVisible();
    await panel.getByRole('button', { name: 'Konfirmasi penerimaan (simulasi penerima)' }).click();
    await expect(panel.getByText(new RegExp(`^Diterima Ns\\. Rosa Elvira, S\\.Kep · ${JAM}$`))).toBeVisible();
  });
});

/** Pilih opsi radio/centang di kelompok field penyaji formulir (legend diawali `field`). */
async function choose(scope: Locator, field: string, option: RegExp) {
  await scope
    .getByRole('group', { name: new RegExp(`^${field}`) })
    .getByLabel(option)
    .check();
}

test.describe('K06 · asesmen dan skrining', () => {
  test('perawat: reasesmen Morse jatuh tempo, wajib lengkap, skor otomatis + tindak lanjut', async ({
    page,
  }) => {
    await openAs(page, ['perawat'], '/klinis/asesmen');
    const pkg = page.getByRole('region', { name: 'Paket asesmen' });
    await expect(pkg.getByText('4 dari 5 final')).toBeVisible();
    const morseItem = pkg.getByRole('button', { name: /Risiko jatuh dewasa \(Morse\)/ });
    await expect(morseItem).toHaveAttribute('aria-pressed', 'true');
    await expect(morseItem).toContainText('Reasesmen jatuh tempo sejak');
    await expect(morseItem).toContainText('Skor 35 · Risiko sedang');

    const morse = page.getByRole('region', { name: 'Risiko jatuh dewasa (Morse)' });
    await expect(morse.getByText(/^Final · Kam, 1 Okt 2026 · 10\.10 · Ns\. Yudi Pratama/)).toBeVisible();
    await morse.getByRole('button', { name: 'Isi reasesmen' }).click();
    await morse.getByRole('button', { name: 'Simpan final' }).click();
    await expect(morse.getByRole('alert')).toHaveText(/^6 isian belum lengkap/);
    await choose(morse, 'Riwayat jatuh', /^Ya/);
    await choose(morse, 'Diagnosis sekunder', /^Ya/);
    await choose(morse, 'Alat bantu', /^Kruk/);
    await choose(morse, 'Terpasang infus', /^Ya/);
    await choose(morse, 'Cara berjalan', /^Lemah/);
    await choose(morse, 'Status mental', /^Sadar/);
    await expect(morse.getByRole('status').filter({ hasText: 'Tindak lanjut:' })).toContainText(
      'Risiko jatuh tinggi',
    );
    await morse.getByRole('button', { name: 'Simpan final' }).click();
    await expect(morse.getByRole('status').filter({ hasText: /^Final · / })).toHaveText(
      new RegExp(`^Final · ${JAM} · Risiko jatuh dewasa \\(Morse\\) · skor 85 Risiko tinggi`),
    );
    await expect(pkg.getByText('5 dari 5 final')).toBeVisible();
    await expect(morseItem).toContainText('Skor 85 · Risiko tinggi');
    await expectNoHorizontalScroll(page);
  });

  test('dokter: hak tulis per profesi; koreksi asesmen medis = versi baru beralasan', async ({ page }) => {
    await openAs(page, ['dokter'], '/klinis/asesmen');
    const morse = page.getByRole('region', { name: 'Risiko jatuh dewasa (Morse)' });
    await expect(morse.getByText('Formulir ini diisi oleh Perawat, Bidan.', { exact: false })).toBeVisible();
    await expect(morse.getByRole('button', { name: 'Isi reasesmen' })).toBeDisabled();

    await page
      .getByRole('region', { name: 'Paket asesmen' })
      .getByRole('button', { name: /Asesmen awal medis/ })
      .click();
    const medis = page.getByRole('region', { name: 'Asesmen awal medis' });
    await medis.getByRole('button', { name: 'Koreksi isian' }).click();
    await choose(medis, 'Keadaan umum', /^Tampak sakit berat/);
    await expect(medis.getByText('Perubahan dari versi 1 (1)')).toBeVisible();
    await medis.getByLabel('Alasan koreksi').fill('Keadaan umum saat masuk tercatat keliru');
    await medis.getByRole('button', { name: 'Simpan koreksi (versi 2)' }).click();
    await expect(medis.getByRole('status').filter({ hasText: 'Koreksi versi 2' })).toBeVisible();
    await expect(medis.getByText('Riwayat versi (2)')).toBeVisible();
  });
});

test.describe('K08 · diagnosis dan problem list', () => {
  test('DPJP: satu diagnosis utama, jadikan utama berversi, salah entri beralasan, diagnosis akhir', async ({
    page,
  }) => {
    await openAs(page, ['dokter'], '/klinis/diagnosis');
    const sec = page.getByRole('region', { name: 'Diagnosis kunjungan' });
    const list = sec.getByRole('list', { name: 'Daftar diagnosis' });
    const first = list.getByRole('listitem').first();
    await expect(first).toContainText('J18.9');
    await expect(first.getByText('Utama', { exact: true })).toBeVisible();

    const add = sec.getByRole('form', { name: 'Tambah diagnosis' });
    await add.getByLabel('Kode ICD-10').selectOption('E87.5');
    await add.getByLabel('Jenis').selectOption('utama');
    await expect(add.getByRole('alert')).toContainText('Diagnosis utama sudah ada (J18.9)');
    await add.getByLabel('Jenis').selectOption('sekunder');
    await add.getByRole('button', { name: 'Tambahkan' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'E87.5 Hiperkalemia tercatat' })).toBeVisible();

    await sec.getByRole('button', { name: 'Jadikan E11.9 diagnosis utama' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'E11.9 kini diagnosis utama' })).toBeVisible();
    await expect(list.getByRole('listitem').filter({ hasText: 'J18.9' })).toContainText('Sekunder');
    await expect(list.getByRole('listitem').filter({ hasText: 'J18.9' })).toContainText('versi 2');

    await sec.getByRole('button', { name: 'Salah entri E87.5' }).click();
    const voidForm = sec.getByRole('form', { name: 'Tandai salah entri' });
    await voidForm.getByLabel('Alasan salah entri').fill('salah');
    await voidForm.getByRole('button', { name: 'Tandai salah entri' }).click();
    await expect(voidForm.getByText(/Wajib minimal 10 karakter/)).toBeVisible();
    await voidForm.getByLabel('Alasan salah entri').fill('Kalium normal, bukan pasien ini');
    await voidForm.getByRole('button', { name: 'Tandai salah entri' }).click();
    await expect(list.getByRole('listitem').filter({ hasText: 'E87.5' })).toContainText(
      'Salah entri · Kalium normal, bukan pasien ini',
    );

    await sec.getByRole('button', { name: 'Tetapkan diagnosis akhir' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Diagnosis akhir ditetapkan' })).toBeVisible();
    await expect(sec.getByText('Diagnosis akhir sudah ditetapkan.')).toBeVisible();

    const problems = page.getByRole('region', { name: 'Problem list' });
    await problems.getByRole('button', { name: 'Tandai J18.9 teratasi' }).click();
    await problems
      .getByRole('form', { name: 'Masalah J18.9 teratasi' })
      .getByRole('button', { name: 'Simpan' })
      .click();
    await problems.getByRole('button', { name: /^Teratasi/ }).click();
    await expect(problems.getByRole('list', { name: 'Daftar masalah' })).toContainText('J18.9');

    const alergi = page.getByRole('region', { name: 'Alergi' });
    await expect(alergi.getByText('Amoksisilin · Sedang')).toBeVisible();
    await expect(alergi.getByRole('button', { name: 'Verifikasi NKDA' })).toBeDisabled();
    await expectNoHorizontalScroll(page);
  });
});

test.describe('K10 · konsultasi dan rawat bersama', () => {
  test('DPJP konsultan: jawab konsul cito terstruktur → rawat bersama; kirim konsul baru', async ({
    page,
  }) => {
    await openAs(page, ['dokter'], '/klinis/konsultasi');
    await expect(banner(page).getByText('Tn. Sutan Batubara')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Konsul masuk' })).toContainText(
      'Tn. Sutan Batubara · Cito',
    );
    const konsul = card(page, /dr\. Melati Kusumawardani, Sp\.JP → dr\. Andini/);
    await expect(konsul.getByText('Belum dijawab · lewat batas 10.30')).toBeVisible();
    await konsul.getByRole('button', { name: 'Jawab konsul' }).click();
    const form = konsul.getByRole('form', { name: 'Jawaban konsul' });
    await form.getByRole('button', { name: 'Tanda tangani jawaban' }).click();
    await expect(form.getByRole('alert')).toHaveText('Isi kesimpulan/diagnosis konsultan.');
    await form
      .getByLabel('Kesimpulan / diagnosis konsultan')
      .fill('CKD stadium 3, risiko nefropati kontras sedang.');
    await form
      .getByLabel('Rekomendasi tata laksana')
      .fill('Hidrasi NaCl 0,9% pra dan pasca kontras; kreatinin ulang 48 jam.');
    await form.getByLabel('Tindak lanjut').selectOption('rawat-bersama');
    await form.getByRole('button', { name: 'Tanda tangani jawaban' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Konsul dijawab' })).toHaveText(
      new RegExp(`Konsul dijawab · ${JAM} · Rawat bersama`),
    );
    await expect(konsul.getByText(/^Dijawab .+ · \d{2}\.\d{2}$/)).toBeVisible();
    const tim = page.getByRole('region', { name: 'Tim perawatan' });
    await expect(tim.getByText(/^DPJP rawat bersama · sejak/)).toBeVisible();

    const kirim = page.getByRole('form', { name: 'Kirim konsul baru' });
    await kirim.getByLabel('Dokter konsultan').selectOption({ label: 'dr. Kartika Sari, Sp.P · Paru' });
    await kirim.getByLabel('Pertanyaan klinis').fill('Sesak?');
    await kirim.getByRole('button', { name: 'Kirim konsul' }).click();
    await expect(kirim.getByRole('alert')).toContainText('minimal 20 karakter');
    await kirim
      .getByLabel('Pertanyaan klinis')
      .fill('Mohon evaluasi sesak napas saat berbaring sebelum angiografi.');
    await kirim.getByRole('button', { name: 'Kirim konsul' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Konsul terkirim' })).toContainText(
      'Konsul terkirim ke dr. Kartika Sari, Sp.P',
    );
    await expectNoHorizontalScroll(page);
  });

  test('residen: jawaban konsul hanya oleh dokter konsultan', async ({ page }) => {
    await openAs(page, ['dokter_residen'], '/klinis/konsultasi');
    const konsul = card(page, /dr\. Melati Kusumawardani, Sp\.JP → dr\. Andini/);
    await expect(konsul.getByRole('button', { name: 'Jawab konsul' })).toBeDisabled();
    await expect(
      konsul.getByText('Jawaban konsul ditandatangani dokter konsultan (posisi dokter).'),
    ).toBeVisible();
  });
});

test.describe('K11 · edukasi terintegrasi', () => {
  test('perawat: edukasi pulang dengan teach-back, tanda tangan penerima, dan atestasi', async ({ page }) => {
    await openAs(page, ['perawat'], '/klinis/edukasi');
    const need = page.getByRole('region', { name: 'Kebutuhan edukasi' });
    await expect(need.getByText('3 dari 6 materi wajib terverifikasi paham')).toBeVisible();
    const form = page.getByRole('form', { name: 'Formulir edukasi' });
    await form.getByLabel(/^Insulin pen dan tanda hipoglikemia/).check();
    await form.getByLabel(/^Perawatan di rumah/).check();
    await form.getByLabel('Demonstrasi + redemonstrasi').check();
    await form.getByLabel('3. Sasaran').selectOption('keluarga');
    await expect(form.getByLabel('Nama penerima', { exact: true })).toHaveValue('Sdr. Dimas Wijaya');
    await form.getByLabel('Paham (mampu menjelaskan ulang)').check();
    await form
      .getByLabel('Ucapan ulang penerima')
      .fill('Suntik glargine 16 unit jam 10 malam; bila gemetar dan keringat dingin minum teh manis.');
    await form.getByLabel(/^5\. Tanda tangan penerima/).fill('Budi');
    await form.getByRole('button', { name: 'Simpan edukasi (final)' }).click();
    await expect(form.getByRole('alert')).toHaveText(
      'Tanda tangan penerima: ketik nama yang sama dengan nama penerima.',
    );
    await form.getByLabel(/^5\. Tanda tangan penerima/).fill('Dimas Wijaya');
    await form.getByRole('button', { name: 'Simpan edukasi (final)' }).click();
    await expect(form.getByRole('alert')).toHaveText('Centang atestasi edukator.');
    await form.getByLabel(/memberikan edukasi ini/).check();
    await form.getByRole('button', { name: 'Simpan edukasi (final)' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Edukasi final' })).toHaveText(
      new RegExp(`Edukasi final · ${JAM} · 2 materi terverifikasi paham`),
    );
    await expect(need.getByText('5 dari 6 materi wajib terverifikasi paham')).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test('bidan: persetujuan tindakan SC baru siap setelah edukasi tindakan terverifikasi', async ({
    page,
  }) => {
    await openAs(page, ['bidan'], `/klinis/edukasi?pasien=${ENCOUNTER_ID.anisa}`);
    const need = page.getByRole('region', { name: 'Kebutuhan edukasi' });
    await expect(need.getByRole('status')).toHaveText(/belum siap/);
    const form = page.getByRole('form', { name: 'Formulir edukasi' });
    await form.getByLabel(/^Tindakan yang direncanakan/).check();
    await form.getByLabel('Lisan / diskusi').check();
    await form.getByLabel('3. Sasaran').selectOption('pasien-keluarga');
    await form.getByLabel('Paham (mampu menjelaskan ulang)').check();
    await form
      .getByLabel('Ucapan ulang penerima')
      .fill('Bayi dilahirkan lewat operasi karena detak jantungnya turun.');
    await form.getByLabel(/^5\. Tanda tangan penerima/).fill('Anisa Rahmadani');
    await form.getByLabel(/memberikan edukasi ini/).check();
    await form.getByRole('button', { name: 'Simpan edukasi (final)' }).click();
    await expect(need.getByRole('status')).toHaveText(/^Persetujuan tindakan siap/);
  });
});

test.describe('K12 · asuhan keperawatan dan gerbang gelang eMAR', () => {
  test('perawat: gelang belum cocok = tidak bisa catat obat; terlambat beralasan; high-alert cek ganda; evaluasi shift', async ({
    page,
  }) => {
    await openAs(page, ['perawat'], '/klinis/asuhan-keperawatan');
    const ronde = page.getByRole('region', { name: 'Ronde obat shift' });
    await expect(ronde.getByText('Pemberian obat terkunci: gelang belum terverifikasi')).toBeVisible();
    const omeprazol = card(page, '08.00 · Omeprazol 40 mg injeksi');
    await expect(omeprazol.getByRole('button', { name: 'Catat pemberian' })).toBeDisabled();
    await expect(omeprazol.getByText(/^Pindai gelang pasien dulu/)).toBeVisible();

    await ronde.getByLabel('Kode gelang (hasil pindai)').fill('00-12-45-78');
    await ronde.getByRole('button', { name: 'Verifikasi gelang' }).click();
    await expect(ronde.getByRole('alert')).toContainText('Gelang tidak cocok (00-12-45-78)');
    await expect(omeprazol.getByRole('button', { name: 'Catat pemberian' })).toBeDisabled();
    await ronde.getByRole('button', { name: 'Pindai gelang (simulasi)' }).click();
    await ronde.getByRole('button', { name: 'Verifikasi gelang' }).click();
    await expect(
      ronde.getByText(/^✓ Pasien benar · gelang terpindai \d{2}\.\d{2} · RM 00-07-61-33$/),
    ).toBeVisible();

    await omeprazol.getByRole('button', { name: 'Catat pemberian' }).click();
    await expect(omeprazol.getByRole('alert')).toContainText('alasan keterlambatan wajib');
    await omeprazol.getByLabel('Alasan keterlambatan').fill('Pasien sedang foto toraks di radiologi');
    await omeprazol.getByRole('button', { name: 'Catat pemberian' }).click();
    await expect(
      omeprazol.getByText(new RegExp(`^✓ Diberikan ${JAM} · .+ · terlambat: Pasien sedang foto toraks`)),
    ).toBeVisible();

    const insulin = card(page, '12.00 · Insulin aspart sesuai skala');
    await insulin.getByRole('button', { name: 'Catat pemberian' }).click();
    await expect(insulin.getByRole('alert')).toContainText('cek ganda oleh perawat kedua wajib');
    await insulin.getByLabel('Perawat pemeriksa kedua').selectOption('Ns. Yudi Pratama, S.Kep');
    await insulin.getByRole('button', { name: 'Catat pemberian' }).click();
    await expect(insulin.getByText(/cek ganda Ns\. Yudi Pratama, S\.Kep$/)).toBeVisible();

    const jatuh = card(page, 'Risiko jatuh (Morse 35)');
    await jatuh.getByRole('button', { name: 'Simpan evaluasi shift' }).click();
    await expect(jatuh.getByRole('alert')).toHaveText('Isi O (data objektif) evaluasi.');
    await jatuh.getByLabel(/^O · Objektif/).fill('Tidak ada kejadian jatuh; bel dalam jangkauan.');
    await jatuh.getByLabel(/^A · Hasil evaluasi/).selectOption('sebagian');
    await jatuh
      .getByLabel(/^P · Rencana lanjut/)
      .fill('Lanjut bundle pencegahan jatuh; reasesmen Morse sebelum pulang.');
    await jatuh.getByRole('button', { name: 'Simpan evaluasi shift' }).click();
    await expect(jatuh.getByText(new RegExp(`^Evaluasi final · ${JAM} · `))).toBeVisible();
    await expect(page.getByRole('region', { name: 'Rencana asuhan keperawatan' })).toContainText(
      'evaluasi 1 dari 3 diagnosis shift ini',
    );
    await expectNoHorizontalScroll(page);
  });
});

test.describe('K14 · ringkasan pasien', () => {
  test('dokter: dari worklist ke ringkasan; nilai kritis di atas, NKDA, obat aktif, kunjungan', async ({
    page,
  }) => {
    await openAs(page, ['dokter'], '/klinis/worklist');
    await page.getByRole('tab', { name: /Pasien saya/ }).click();
    await page
      .getByRole('region', { name: 'Pasien saya' })
      .getByRole('link', { name: 'Tn. Yusuf Hidayat' })
      .click();
    await expect(page).toHaveURL(new RegExp(`/klinis/ringkasan\\?pasien=${ENCOUNTER_ID.yusuf}`));
    await expect(
      page.getByRole('heading', { level: 1, name: 'Ringkasan pasien · Tn. Yusuf Hidayat' }),
    ).toBeVisible();
    await expect(page.getByRole('region', { name: 'Flag risiko' })).toContainText(
      'Nilai kritis: Kalium 6,4 mmol/L',
    );
    const hasil = page.getByRole('list', { name: 'Daftar hasil' }).getByRole('listitem');
    await expect(hasil.first()).toContainText('Kalium');
    await expect(hasil.first()).toContainText('Kritis');
    await expect(page.getByRole('region', { name: 'Alergi' })).toContainText(
      'Tidak ada alergi yang diketahui (NKDA)',
    );
    await expect(page.getByRole('region', { name: 'Obat aktif' })).toContainText('Kalsium karbonat 500 mg');
    await expect(page.getByRole('region', { name: 'Problem aktif' })).toContainText('N18.5');
    await expect(page.getByRole('region', { name: 'Kunjungan terakhir' })).toContainText(
      'Hemodialisis rutin',
    );
    await expectNoHorizontalScroll(page);
  });
});

test.describe('K15 · paket layanan khusus', () => {
  test('perawat: siklus kemoterapi tertahan kelengkapan dan gerbang Hb; override beralasan → mulai → selesai', async ({
    page,
  }) => {
    await openAs(page, ['perawat'], '/klinis/paket-layanan');
    await expect(banner(page).getByText('Ny. Maria Ulfa')).toBeVisible();
    const gate = page.getByRole('region', { name: 'Gerbang sesi' });
    const start = gate.getByRole('button', { name: 'Mulai pemberian siklus' });
    await expect(start).toBeDisabled();
    await expect(gate.getByText(/^Lengkapi dulu: Verifikasi ganda dosis/)).toBeVisible();
    await page
      .getByRole('button', { name: 'Tandai selesai: Verifikasi ganda dosis (apoteker + perawat)' })
      .click();
    await expect(gate.getByText(/^Hasil lab di bawah ambang protokol/)).toBeVisible();
    await expect(start).toBeDisabled();
    await gate.getByRole('button', { name: 'Lanjut dengan alasan klinis' }).click();
    await gate.getByLabel(/^Alasan klinis/).fill('Transfusi PRC 1 unit selesai, Hb ulang 10,2 g/dL');
    await gate.getByRole('button', { name: 'Simpan alasan dan lanjut' }).click();
    await expect(gate.getByText(/^Override tercatat · Transfusi PRC/)).toBeVisible();
    await start.click();
    await expect(page.getByRole('status').filter({ hasText: 'Kemoterapi dimulai' })).toBeVisible();
    await gate.getByRole('button', { name: 'Selesaikan siklus hari ini' }).click();
    const jadwal = page.getByRole('list', { name: 'Jadwal sesi' });
    await expect(jadwal.getByRole('listitem').filter({ hasText: 'Siklus 4' })).toContainText(
      new RegExp(`Selesai ${JAM}`),
    );
    await expectNoHorizontalScroll(page);
  });

  test('hemodialisis: butir resep HD hanya diisi DPJP', async ({ page }) => {
    await openAs(page, ['perawat'], `/klinis/paket-layanan?pasien=${ENCOUNTER_ID.yusuf}`);
    await expect(
      page.getByRole('button', { name: 'Tandai selesai: Resep HD DPJP (durasi, target UF, antikoagulan)' }),
    ).toBeDisabled();
    await expect(page.getByText('Diisi oleh Dokter (DPJP).').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Mulai sesi HD' })).toBeDisabled();
  });
});

test.describe('K13 · kelengkapan rekam medis dan gerbang tutup kunjungan', () => {
  test('DPJP: perbaiki butir inline; tutup kunjungan tetap terkunci sampai resume dan edukasi lengkap', async ({
    page,
  }) => {
    await openAs(page, ['dokter'], '/klinis/kelengkapan');
    const cek = page.getByRole('region', { name: 'Kelengkapan rekam medis' });
    await expect(cek.getByText('3 dari 7 terpenuhi · 43%')).toBeVisible();
    const close = cek.getByRole('button', { name: 'Tutup kunjungan' });
    await expect(close).toBeDisabled();
    await expect(cek.getByText(/^4 butir kelengkapan belum terpenuhi/)).toBeVisible();
    await cek.getByRole('button', { name: 'Co-sign sekarang' }).click();
    await cek.getByRole('button', { name: 'Kirim ulang TTE' }).click();
    await expect(cek.getByText('5 dari 7 terpenuhi · 71%')).toBeVisible();
    const dok = page.getByRole('region', { name: 'Dokumen pasien' });
    await expect(
      dok
        .getByRole('listitem')
        .filter({ hasText: 'Surat kontrol Poli Penyakit Dalam' })
        .getByText('Final · TTE'),
    ).toBeVisible();
    await cek.getByLabel('Disposisi').selectOption('pulang');
    await expect(close).toBeDisabled();
    await expect(cek.getByText(/^2 butir kelengkapan belum terpenuhi: Edukasi pulang/)).toBeVisible();
    await expect(cek.getByRole('link', { name: 'Lengkapi di layar asal' }).first()).toBeVisible();

    await dok.getByRole('button', { name: 'Batalkan Hasil lab luar RS (pindaian)' }).click();
    const batal = dok.getByRole('form', { name: 'Batalkan dokumen' });
    await batal.getByLabel('Alasan pembatalan').fill('Hasil milik pasien lain, salah unggah');
    await batal.getByRole('button', { name: 'Batalkan dokumen' }).click();
    await expect(
      dok.getByRole('listitem').filter({ hasText: 'Hasil lab luar RS (pindaian)' }).getByText('Dibatalkan'),
    ).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test('DPJP: kunjungan rawat jalan lengkap ditutup dengan disposisi; residen tidak bisa menutup', async ({
    page,
  }) => {
    await openAs(page, ['dokter'], `/klinis/kelengkapan?pasien=${ENCOUNTER_ID.rohana}`);
    const cek = page.getByRole('region', { name: 'Kelengkapan rekam medis' });
    await expect(cek.getByText(/terpenuhi · 100%/)).toBeVisible();
    await expect(cek.getByRole('button', { name: 'Tutup kunjungan' })).toBeDisabled();
    await cek.getByLabel('Disposisi').selectOption('pulang');
    await cek.getByRole('button', { name: 'Tutup kunjungan' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Rekam medis terkunci' })).toHaveText(
      new RegExp(`^Kunjungan ditutup · ${JAM} · Pulang atas persetujuan DPJP`),
    );
  });

  test('residen: tutup kunjungan hanya oleh DPJP', async ({ page }) => {
    await openAs(page, ['dokter_residen'], `/klinis/kelengkapan?pasien=${ENCOUNTER_ID.rohana}`);
    const cek = page.getByRole('region', { name: 'Kelengkapan rekam medis' });
    await cek.getByLabel('Disposisi').selectOption('pulang');
    await expect(cek.getByRole('button', { name: 'Tutup kunjungan' })).toBeDisabled();
    await expect(cek.getByText('Kunjungan ditutup oleh DPJP (posisi dokter).')).toBeVisible();
  });
});

/** Masuk dengan akun berposisi ganda, pilih posisi awal, lalu buka `path`. */
async function loginWithPosition(page: Page, account: Account, roleName: string, path: string) {
  await page.goto('/');
  await expect(page).toHaveURL(/\/masuk/);
  await submitPassword(page, account, account.password);
  await typeCode(page, totpFor(account.totpSecret as string));
  await page.getByRole('button', { name: 'Verifikasi dan lanjut' }).click();
  await expect(page.getByRole('heading', { name: 'Pilih posisi dan unit kerja' })).toBeVisible();
  await page.getByText(roleName, { exact: true }).click();
  await page.getByRole('button', { name: `Masuk sebagai ${roleName}` }).click();
  await expect(
    page.getByText(new RegExp(`Anda masuk sebagai\\s*${roleName.replace(/[()]/g, '\\$&')}`)),
  ).toBeVisible();
  await page.goto(path);
}

async function switchPosition(page: Page, roleName: string) {
  await page.getByRole('link', { name: 'Ganti posisi' }).first().click();
  await expect(page.getByRole('heading', { name: 'Ganti posisi', level: 1 })).toBeVisible();
  await page.getByText(roleName, { exact: true }).click();
  await page.getByRole('button', { name: `Pindah ke ${roleName}` }).click();
  await expect(
    page.getByText(new RegExp(`Anda masuk sebagai\\s*${roleName.replace(/[()]/g, '\\$&')}`)),
  ).toBeVisible();
}

/**
 * Toko demo bersama (ADR-0085): aksi bagan RME bertahan setelah muat ulang dan mengalir antarlayar (worklist ↔ CPPT
 * ↔ kelengkapan, asesmen ↔ worklist, konsul ↔ worklist, eMAR askep ↔ rawat inap, nilai kritis lab → worklist,
 * ringkasan, rawat inap). Setiap akun uji punya ruang data sendiri.
 */
test.describe('bagan RME tersimpan dan mengalir', () => {
  test('co-sign di worklist → CPPT final → kelengkapan; bertahan setelah muat ulang', async ({ page }) => {
    await openAs(page, ['dokter'], '/klinis/worklist');
    await card(page, /CPPT residen 07\.40/)
      .getByRole('button', { name: 'Co-sign sekarang' })
      .click();
    await expect(page.getByRole('status').filter({ hasText: 'Co-sign DPJP' })).toBeVisible();
    await page.reload();
    await expect(card(page, /CPPT residen 07\.40/)).toHaveCount(0);
    await page.getByRole('tab', { name: /Selesai/ }).click();
    await expect(page.getByText(new RegExp(`✓ Co-sign DPJP · CPPT residen final · ${JAM}`))).toBeVisible();

    await page.goto(`/klinis/cppt?pasien=${ENCOUNTER_ID.endang}`);
    await expect(
      note(page, 'Pneumonia komunitas perbaikan; DM hiperglikemia.').getByText(
        new RegExp(`^Final · co-sign DPJP .+ · ${JAM}$`),
      ),
    ).toBeVisible();
    await page.goto(`/klinis/kelengkapan?pasien=${ENCOUNTER_ID.endang}`);
    const cek = page.getByRole('region', { name: 'Kelengkapan rekam medis' });
    await expect(cek.getByText('✓ Semua CPPT residen sudah co-sign DPJP')).toBeVisible();
    await expect(cek.getByText('4 dari 7 terpenuhi · 57%')).toBeVisible();
    await page.goto(`/klinis/rawat-inap/${ENCOUNTER_ID.endang}`);
    await expect(
      page
        .getByRole('list', { name: 'Catatan CPPT' })
        .getByRole('listitem')
        .filter({ hasText: 'Pneumonia komunitas perbaikan' })
        .first(),
    ).toContainText('Co-sign DPJP');
  });

  test('asesmen, diagnosis, edukasi, dan konsul bertahan; worklist dan kelengkapan membaca hasilnya', async ({
    page,
  }) => {
    const akun = await createAccount({ roles: ['dokter', 'perawat'] });
    await loginWithPosition(page, akun, 'Dokter (DPJP)', `/klinis/diagnosis?pasien=${ENCOUNTER_ID.endang}`);
    const sec = page.getByRole('region', { name: 'Diagnosis kunjungan' });
    await sec.getByRole('button', { name: 'Tetapkan diagnosis akhir' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Diagnosis akhir ditetapkan' })).toBeVisible();
    await page.reload();
    await expect(sec.getByText('Diagnosis akhir sudah ditetapkan.')).toBeVisible();

    await page.goto('/klinis/konsultasi');
    const konsul = card(page, /dr\. Melati Kusumawardani, Sp\.JP → dr\. Andini/);
    await konsul.getByRole('button', { name: 'Jawab konsul' }).click();
    const form = konsul.getByRole('form', { name: 'Jawaban konsul' });
    await form
      .getByLabel('Kesimpulan / diagnosis konsultan')
      .fill('CKD stadium 3, risiko nefropati kontras sedang.');
    await form.getByLabel('Rekomendasi tata laksana').fill('Hidrasi NaCl 0,9% pra dan pasca kontras.');
    await form.getByRole('button', { name: 'Tanda tangani jawaban' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Konsul dijawab' })).toBeVisible();
    await page.reload();
    await expect(
      card(page, /dr\. Melati Kusumawardani, Sp\.JP → dr\. Andini/).getByText(/^Dijawab .+ · \d{2}\.\d{2}$/),
    ).toBeVisible();
    await page.goto('/klinis/worklist');
    await expect(card(page, /Konsul cito dari dr\. Melati/)).toHaveCount(0);
    await page.getByRole('tab', { name: /Selesai/ }).click();
    await expect(page.getByText(new RegExp(`✓ Konsul dijawab · ${JAM}`))).toBeVisible();

    // Perawat: reasesmen Morse → worklist perawat menutup tugasnya; edukasi pulang → kelengkapan.
    await switchPosition(page, 'Perawat');
    await page.goto(`/klinis/asesmen?pasien=${ENCOUNTER_ID.endang}`);
    const morse = page.getByRole('region', { name: 'Risiko jatuh dewasa (Morse)' });
    await morse.getByRole('button', { name: 'Isi reasesmen' }).click();
    await choose(morse, 'Riwayat jatuh', /^Tidak/);
    await choose(morse, 'Diagnosis sekunder', /^Ya/);
    await choose(morse, 'Alat bantu', /^Tidak ada/);
    await choose(morse, 'Terpasang infus', /^Tidak/);
    await choose(morse, 'Cara berjalan', /^Normal/);
    await choose(morse, 'Status mental', /^Sadar/);
    await morse.getByRole('button', { name: 'Simpan final' }).click();
    await expect(morse.getByRole('status').filter({ hasText: /^Final · / })).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole('region', { name: 'Paket asesmen' }).getByText('5 dari 5 final'),
    ).toBeVisible();
    await page.goto('/klinis/worklist');
    await expect(card(page, /Reasesmen risiko jatuh \(Morse\)/)).toHaveCount(0);

    await page.goto(`/klinis/edukasi?pasien=${ENCOUNTER_ID.endang}`);
    const edu = page.getByRole('form', { name: 'Formulir edukasi' });
    for (const t of [/^Insulin pen dan tanda hipoglikemia/, /^Perawatan di rumah/, /^Pencegahan jatuh/]) {
      const box = edu.getByLabel(t);
      if (!(await box.isChecked())) await box.check();
    }
    await edu.getByLabel('Demonstrasi + redemonstrasi').check();
    await edu.getByLabel('3. Sasaran').selectOption('keluarga');
    await edu.getByLabel('Paham (mampu menjelaskan ulang)').check();
    await edu
      .getByLabel('Ucapan ulang penerima')
      .fill('Suntik glargine malam; bila gemetar minum teh manis.');
    await edu.getByLabel(/^5\. Tanda tangan penerima/).fill('Dimas Wijaya');
    await edu.getByLabel(/memberikan edukasi ini/).check();
    await edu.getByRole('button', { name: 'Simpan edukasi (final)' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Edukasi final' })).toBeVisible();
    await page.reload();
    const need = page.getByRole('region', { name: 'Kebutuhan edukasi' });
    await expect(need.getByText('6 dari 6 materi wajib terverifikasi paham')).toBeVisible();
    // Mengalir: butir edukasi di Kelengkapan (layar DPJP/rekam medis) ikut terpenuhi.
    await switchPosition(page, 'Dokter (DPJP)');
    await page.goto(`/klinis/kelengkapan?pasien=${ENCOUNTER_ID.endang}`);
    await expect(
      page
        .getByRole('region', { name: 'Kelengkapan rekam medis' })
        .getByText('✓ Edukasi pulang terverifikasi paham'),
    ).toBeVisible();
  });

  test('nilai kritis dilaporkan Lab → worklist, ringkasan, dan rawat inap dokter', async ({ page }) => {
    const akun = await createAccount({
      roles: ['analis_lab', 'dokter'],
      displayName: 'Analis Klinis Fiktif',
    });
    await loginWithPosition(page, akun, 'Analis laboratorium', '/penunjang/lab');
    const kritis = page.getByRole('region', { name: /Nilai kritis terbuka · Tn\. Yusuf Hidayat/ });
    await kritis.getByRole('button', { name: 'Catat pelaporan' }).click();
    await kritis
      .getByRole('textbox', { name: 'Nama penerima laporan (DPJP / dokter jaga)' })
      .fill('dr. Jaga Penerima Fiktif');
    await kritis.getByRole('checkbox', { name: /Read-back/ }).check();
    await kritis.getByRole('button', { name: 'Simpan pelaporan' }).click();
    await expect(
      page.getByRole('region', { name: /Nilai kritis dilaporkan · Tn\. Yusuf Hidayat/ }),
    ).toBeVisible();

    await switchPosition(page, 'Dokter (DPJP)');
    await page.goto('/klinis/worklist');
    await expect(card(page, /Kalium 6,4 mmol\/L \(kritis\)/)).toContainText(
      /Lab: dilaporkan Analis Klinis Fiktif ke dr\. Jaga Penerima Fiktif/,
    );
    await page.goto(`/klinis/ringkasan?pasien=${ENCOUNTER_ID.yusuf}`);
    await expect(page.getByRole('region', { name: 'Pelaporan nilai kritis' })).toContainText(
      'Dilaporkan Analis Klinis Fiktif ke dr. Jaga Penerima Fiktif',
    );
    await page.goto(`/klinis/rawat-inap/${ENCOUNTER_ID.yusuf}`);
    await expect(page.getByRole('region', { name: 'Nilai kritis pasien' })).toContainText(
      'dilaporkan Analis Klinis Fiktif ke dr. Jaga Penerima Fiktif',
    );
  });

  test('ronde obat askep + evaluasi + paket + tutup kunjungan bertahan setelah muat ulang', async ({
    page,
  }) => {
    const akun = await createAccount({ roles: ['perawat', 'dokter'] });
    await loginWithPosition(
      page,
      akun,
      'Perawat',
      `/klinis/asuhan-keperawatan?pasien=${ENCOUNTER_ID.endang}`,
    );
    const ronde = page.getByRole('region', { name: 'Ronde obat shift' });
    await ronde.getByRole('button', { name: 'Pindai gelang (simulasi)' }).click();
    await ronde.getByRole('button', { name: 'Verifikasi gelang' }).click();
    const omeprazol = card(page, '08.00 · Omeprazol 40 mg injeksi');
    await omeprazol.getByRole('button', { name: 'Catat pemberian' }).click();
    await omeprazol.getByLabel('Alasan keterlambatan').fill('Pasien sedang foto toraks di radiologi');
    await omeprazol.getByRole('button', { name: 'Catat pemberian' }).click();
    await expect(omeprazol.getByText(/^✓ Diberikan/)).toBeVisible();
    const jatuh = card(page, 'Risiko jatuh (Morse 35)');
    await jatuh.getByLabel(/^O · Objektif/).fill('Tidak ada kejadian jatuh; bel dalam jangkauan.');
    await jatuh.getByLabel(/^A · Hasil evaluasi/).selectOption('sebagian');
    await jatuh.getByLabel(/^P · Rencana lanjut/).fill('Lanjut bundle pencegahan jatuh.');
    await jatuh.getByRole('button', { name: 'Simpan evaluasi shift' }).click();
    await expect(jatuh.getByText(new RegExp(`^Evaluasi final · ${JAM} · `))).toBeVisible();
    await page.reload();
    await expect(card(page, '08.00 · Omeprazol 40 mg injeksi').getByText(/^✓ Diberikan/)).toBeVisible();
    await expect(
      card(page, 'Risiko jatuh (Morse 35)').getByText(new RegExp(`^Evaluasi final · ${JAM} · `)),
    ).toBeVisible();
    // Mengalir: eMAR Rawat inap membaca pemberian yang sama.
    await page.goto(`/klinis/rawat-inap/${ENCOUNTER_ID.endang}`);
    await expect(
      page.getByRole('region', { name: 'eMAR' }).getByRole('list', { name: 'Pemberian tercatat' }),
    ).toContainText('Omeprazol 40 mg injeksi');

    // Paket layanan: sesi kemoterapi bertahan.
    await page.goto('/klinis/paket-layanan');
    await page
      .getByRole('button', { name: 'Tandai selesai: Verifikasi ganda dosis (apoteker + perawat)' })
      .click();
    await expect(
      page
        .getByRole('status')
        .filter({ hasText: /^Verifikasi ganda dosis \(apoteker \+ perawat\) · selesai/ }),
    ).toBeVisible();
    const gate = page.getByRole('region', { name: 'Gerbang sesi' });
    await gate.getByRole('button', { name: 'Lanjut dengan alasan klinis' }).click();
    await gate.getByLabel(/^Alasan klinis/).fill('Transfusi PRC 1 unit selesai, Hb ulang 10,2 g/dL');
    await gate.getByRole('button', { name: 'Simpan alasan dan lanjut' }).click();
    await gate.getByRole('button', { name: 'Mulai pemberian siklus' }).click();
    await expect(gate.getByRole('button', { name: 'Selesaikan siklus hari ini' })).toBeVisible();
    await page.reload();
    await expect(gate.getByText(/^Override tercatat · Transfusi PRC/)).toBeVisible();
    await gate.getByRole('button', { name: 'Selesaikan siklus hari ini' }).click();
    await expect(
      page.getByRole('list', { name: 'Jadwal sesi' }).getByRole('listitem').filter({ hasText: 'Siklus 4' }),
    ).toContainText(new RegExp(`Selesai ${JAM}`));

    // Tutup kunjungan rawat jalan (DPJP) bertahan: rekam terkunci.
    await switchPosition(page, 'Dokter (DPJP)');
    await page.goto(`/klinis/kelengkapan?pasien=${ENCOUNTER_ID.rohana}`);
    const cek = page.getByRole('region', { name: 'Kelengkapan rekam medis' });
    await cek.getByLabel('Disposisi').selectOption('pulang');
    await cek.getByRole('button', { name: 'Tutup kunjungan' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Rekam medis terkunci' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('status').filter({ hasText: 'Rekam medis terkunci' })).toBeVisible();
    await expect(cek.getByRole('button', { name: 'Tutup kunjungan' })).toHaveCount(0);
  });

  test('K-1: disposisi meninggal hanya DPJP pasien, dengan surat keterangan kematian ber-TTE', async ({
    page,
  }) => {
    await openAs(page, ['dokter'], `/klinis/kelengkapan?pasien=${ENCOUNTER_ID.rohana}`);
    const cek = page.getByRole('region', { name: 'Kelengkapan rekam medis' });
    await cek.getByLabel('Disposisi').selectOption('meninggal');
    const close = cek.getByRole('button', { name: 'Tutup kunjungan' });
    await expect(close).toBeDisabled();
    await expect(cek.getByText(/membutuhkan surat keterangan kematian yang sudah ber-TTE/)).toBeVisible();
    const skk = cek.getByRole('form', { name: 'Surat keterangan kematian' });
    await expect(skk).toContainText('menunggu konfirmasi pemilik produk');
    await skk.getByLabel('Jam kematian (HH.MM)').fill('09.15');
    await skk.getByLabel('Sebab kematian (ICD-10)').selectOption('J96.0');
    await skk.getByLabel(/Tanda tangani surat keterangan kematian/).check();
    await skk.getByRole('button', { name: 'Terbitkan surat keterangan kematian' }).click();
    const dok = page.getByRole('region', { name: 'Dokumen pasien' });
    await expect(dok.getByRole('listitem').filter({ hasText: 'Surat keterangan kematian' })).toContainText(
      'J96.0 Gagal napas akut',
    );
    await cek.getByLabel('Disposisi').selectOption('meninggal');
    await expect(close).toBeEnabled();
    await close.click();
    await expect(page.getByRole('status').filter({ hasText: 'Rekam medis terkunci' })).toContainText(
      'Meninggal',
    );
  });
});
