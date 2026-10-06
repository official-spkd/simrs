import { expect, type Page, test } from '@playwright/test';
import { type Account, createAccount, loginAs, submitPassword, totpFor, typeCode } from '../support/accounts';
import { CONSENT_ID, ENCOUNTER_ID } from '../../src/lib/demo/fixtures/ids';

/**
 * IGD, tempat tidur, rawat inap, resume, dan persetujuan tindakan (mode presentasi, ADR-0023; mockup IGD,
 * BedManagement, Ranap, Resume, Consent). Akun baru = keadaan simulasi baru (semua skenario di langkah awal) dan
 * ruang data toko demo sendiri (ADR-0085): aksi bertahan setelah muat ulang dan mengalir ke layar terkait.
 */

async function openAs(page: Page, roles: string[], path: string) {
  const account = await createAccount({ roles });
  await loginAs(page, account, path);
  await page.goto(path);
}

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

/** Lompat skenario aktif di layar Simulasi ke tahap `stage` (tugas sebelumnya dikerjakan dengan nilai bawaan). */
async function jumpTo(page: Page, stage: string) {
  await page.getByText('Lompat ke tahap', { exact: true }).click();
  await page.getByRole('button', { name: new RegExp(`^\\d+\\. ${stage}$`) }).click();
  await expect(page.getByText(new RegExp(`Langkah \\d+ dari \\d+ · ${stage}`))).toBeVisible();
}

/** Pilih tab skenario di layar Simulasi lalu lompat ke tahapnya. */
async function scenarioAt(page: Page, tab: string, patient: string, stage: string) {
  await page.goto('/simulasi');
  await page.getByRole('tab', { name: tab }).click();
  await expect(page.getByText(patient).first()).toBeVisible();
  await jumpTo(page, stage);
}

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe('IGD', () => {
  test('papan menampilkan nomor triase; turun dari saran sistem wajib alasan', async ({ page }) => {
    await openAs(page, ['perawat'], '/klinis/igd');
    await expect(page.getByRole('heading', { name: 'Instalasi Gawat Darurat', level: 1 })).toBeVisible();
    const board = page.getByRole('region', { name: 'Papan pasien IGD' });
    await expect(board.getByText('1 · Resusitasi')).toBeVisible();
    await expect(board.getByText('5 · Tidak urgen')).toBeVisible();
    // Pasien skenario IGD → rawat inap ada di area triase sejak skenario dimulai, anonim sampai dicocokkan di MPI.
    await expect(
      board.getByRole('button', { name: /Pasien laki-laki ±60 th · identitas belum dicocokkan/ }),
    ).toContainText('Belum triase');
    await expect(board.getByText('Tn. Hartono Wibisono')).toHaveCount(0);

    const zones = board.getByRole('tablist', { name: 'Zona IGD' });
    await zones.getByRole('tab', { name: /^Resusitasi · \d+$/ }).click();
    await expect(zones.getByRole('tab', { name: /^Resusitasi/ })).toHaveAttribute('aria-selected', 'true');
    await zones.getByRole('tab', { name: /^Semua zona/ }).click();
    await board.getByRole('button', { name: 'Level 4 · Semi-urgen' }).click();
    const rows = board.getByRole('list', { name: 'Pasien di IGD' }).getByRole('listitem');
    await expect(rows).toHaveCount(2);
    await board.getByRole('button', { name: 'Semua level' }).click();

    await board.getByRole('button', { name: /Ny\. Lestiani Hapsari/ }).click();
    const panel = page.getByRole('complementary', { name: 'Triase pasien' });
    await expect(panel.getByRole('heading', { name: /Ny\. Lestiani Hapsari/ })).toBeVisible();
    await expect(panel.getByRole('timer', { name: 'Lama di IGD' })).toBeVisible();
    await panel.locator('label', { has: page.getByRole('radio', { name: /^Level 3 · Urgen/ }) }).click();
    const save = panel.getByRole('button', { name: /^Simpan triase 3/ });
    await expect(save).toBeDisabled();
    await expect(panel.getByRole('status').filter({ hasText: 'Sistem menyarankan triase 2.' })).toBeVisible();

    // Alasan turun level: input inline berlabel (mockup), minimal 10 karakter; simpan tetap nonaktif sampai cukup.
    const reason = panel.getByRole('textbox', {
      name: 'Alasan memilih level lebih rendah dari saran (triase 2)',
    });
    await expect(
      panel.getByText('Wajib diisi (minimal 10 karakter) sebelum triase bisa disimpan.'),
    ).toBeVisible();
    await reason.fill('Membaik');
    await expect(save).toBeDisabled();
    await reason.fill('Kekuatan motorik kembali penuh, bicara jelas');
    await expect(panel.getByText('Alasan tercatat di jejak audit triase.')).toBeVisible();
    await expect(save).toBeEnabled();
    await save.click();
    const saved = panel.getByRole('status').filter({ hasText: /Triase 3 tersimpan \d{2}\.\d{2}/ });
    await expect(saved).toContainText('override beralasan tercatat di jejak audit');
    await expect(saved).not.toContainText('tidak disimpan');
    await expect(board.getByRole('button', { name: /Ny\. Lestiani Hapsari/ })).toContainText('3 · Urgen');
    await expectNoHorizontalScroll(page);

    // Bertahan: triase tersimpan di toko demo, tetap ada setelah muat ulang.
    await page.reload();
    await expect(board.getByRole('button', { name: /Ny\. Lestiani Hapsari/ })).toContainText('3 · Urgen');
    await board.getByRole('button', { name: /Ny\. Lestiani Hapsari/ }).click();
    await expect(panel.getByRole('status').filter({ hasText: /Triase 3 tersimpan/ })).toBeVisible();
  });
});

test.describe('tempat tidur', () => {
  test('ubin status bertulisan, filter bangsal/status, alokasi bed ke permintaan', async ({ page }) => {
    await openAs(page, ['perawat'], '/klinis/tempat-tidur');
    await expect(page.getByRole('heading', { name: 'Manajemen tempat tidur', level: 1 })).toBeVisible();
    const tiles = page.getByRole('region', { name: 'Ringkasan status bed' });
    for (const t of ['Total bed', 'Terisi', 'Siap pakai', 'Dibersihkan', 'Rencana pulang hari ini']) {
      await expect(tiles.getByText(t, { exact: true })).toBeVisible();
    }
    await expect(page.getByText(/^Aplicare & SIRANAP diperbarui \d{2}\.\d{2}$/)).toBeVisible();

    const filters = page.getByRole('group', { name: 'Filter tempat tidur' });
    await filters.getByLabel('Bangsal').selectOption('ICU');
    await filters.getByLabel('Status').selectOption('siap');
    await expect(filters.getByText('1 dari 286 bed ditampilkan')).toBeVisible();
    const icu = page.getByRole('region', { name: 'Peta ICU/ICCU' });
    await expect(icu.getByRole('button', { name: /ICU 3/ })).toContainText('Siap');

    await filters.getByLabel('Bangsal').selectOption('MELATI');
    const melati = page.getByRole('region', { name: 'Peta Bangsal Melati' });
    await melati.getByRole('button').filter({ hasNotText: 'M-210' }).first().click();
    const requests = page.getByRole('region', { name: 'Permintaan bed' });
    await requests.getByRole('button', { name: /^Alokasikan Ny\. Maria ke bed M-\d+$/ }).click();
    await expect(requests.getByRole('status')).toContainText(/Ny\. Maria dialokasikan ke M-\d+ · dipesan/);

    await filters.getByLabel('Status').selectOption('semua');
    await page.getByRole('tab', { name: 'Daftar' }).click();
    await expect(page.getByRole('list', { name: 'Daftar tempat tidur' })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
});

test.describe('rawat inap', () => {
  test('daftar pasien → rekam rawat inap; eMAR terkunci sampai gelang cocok', async ({ page }) => {
    await openAs(page, ['perawat'], '/klinis/rawat-inap');
    await expect(page.getByRole('heading', { name: 'Pasien rawat inap', level: 1 })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.getByRole('link', { name: /Ny\. Endang Wijaya/ }).click();
    await expect(
      page.getByRole('heading', { name: 'Rawat inap · Bangsal Melati M-203', level: 1 }),
    ).toBeVisible();
    await expect(page.getByLabel('Identitas pasien')).toContainText('Alergi: Amoksisilin');

    const emar = page.getByRole('region', { name: 'eMAR' });
    const dose = emar.getByRole('button', { name: /^Insulin aspart sesuai skala jam 12\.00/ });
    await expect(dose).toBeDisabled();
    await expect(emar.getByRole('alert')).toContainText('Pemberian obat terkunci sampai gelang pasien cocok');
    // Mockup Ranap: dua baris status gerbang, tautan cepat yang selalu terlihat, ubin EWS dan GDS terakhir.
    await expect(
      emar.getByRole('status').filter({ hasText: '○ Pasien · gelang belum dipindai' }),
    ).toContainText('○ Obat · pemberian nonaktif sampai gelang cocok');
    const quick = page.getByRole('navigation', { name: 'Tautan cepat pasien' });
    for (const l of ['Order & resep (CPOE)', 'Persetujuan tindakan', 'Resume medis', 'Perencanaan pulang']) {
      await expect(quick.getByText(l)).toBeVisible();
    }
    const tiles = emar.getByRole('list', { name: 'Pantauan terakhir' });
    await expect(tiles).toContainText(/EWS dewasa \d{2}\.\d{2}/);
    await expect(tiles).toContainText('GDS terakhir');
    await expect(page.getByRole('heading', { name: /^CPPT terintegrasi · \d+ \w+$/ })).toBeVisible();
    await emar.getByRole('button', { name: 'Pindai gelang', exact: true }).click();
    await expect(emar.getByText(/Pasien benar · gelang terpindai/)).toBeVisible();
    await expect(dose).toBeEnabled();

    // Satu dosis: pilih slot → pindai label obat → (kewaspadaan tinggi: cek ganda perawat kedua) → catat.
    await dose.click();
    const insulin = emar.getByRole('region', { name: /^Insulin aspart sesuai skala · jadwal 12\.00/ });
    const record = insulin.getByRole('button', { name: 'Catat pemberian' });
    await expect(record).toBeDisabled();
    await expect(insulin.getByText('Pindai label obat dulu.')).toBeVisible();
    await insulin.getByRole('button', { name: 'Pindai label obat' }).click();
    await expect(insulin.getByText(/Obat benar · label terpindai/)).toBeVisible();
    await expect(record).toBeDisabled();
    await expect(insulin.getByText('Isi nama perawat kedua yang melakukan cek ganda.')).toBeVisible();
    await insulin.getByLabel(/Cek ganda: nama perawat kedua/).fill('Ns. Pemeriksa Kedua');
    await record.click();
    await expect(emar.getByText('Pemberian tercatat shift ini')).toBeVisible();
    await expect(dose).toContainText('cek ganda');
    await expect(insulin).toHaveCount(0);

    // Dosis terlambat (status dari rekam server) wajib alasan.
    await emar.getByRole('button', { name: /^Omeprazol 40 mg injeksi jam 08\.00/ }).click();
    const lateDose = emar.getByRole('region', { name: /^Omeprazol 40 mg injeksi · jadwal 08\.00 terlambat/ });
    await lateDose.getByRole('button', { name: 'Pindai label obat' }).click();
    const late = lateDose.getByRole('button', { name: 'Catat pemberian terlambat' });
    await expect(late).toBeDisabled();
    await lateDose.getByLabel(/Alasan keterlambatan/).fill('Pasien sedang foto toraks di radiologi');
    await late.click();
    await expect(emar.getByText(/terlambat · Pasien sedang foto toraks/)).toBeVisible();

    // CPPT: S dan A wajib; koreksi disimpan sebagai versi baru.
    const cppt = page.getByRole('region', { name: 'CPPT terintegrasi' });
    await cppt.getByRole('button', { name: '+ Tulis CPPT (SOAP)' }).click();
    await cppt.getByRole('button', { name: 'Simpan dan tanda tangani' }).click();
    await expect(cppt.getByText('S wajib diisi.')).toBeVisible();
    await expect(cppt.getByText('Versi 2 · koreksi: Salah ketik nilai SpO2')).toBeVisible();
    await expectNoHorizontalScroll(page);

    // Bertahan: pemberian obat tersimpan di toko demo (gelang dipindai ulang hanya untuk dosis berikutnya).
    await page.reload();
    await expect(emar.getByText('Pemberian tercatat shift ini')).toBeVisible();
    await expect(dose).toContainText('cek ganda');
    await expect(emar.getByRole('list', { name: 'Pemberian tercatat' })).toContainText(
      'Pasien sedang foto toraks',
    );
    // Mengalir: ronde obat Asuhan keperawatan membaca eMAR yang sama.
    await page.goto(`/klinis/asuhan-keperawatan?pasien=${ENCOUNTER_ID.endang}`);
    await expect(page.getByRole('article', { name: '08.00 · Omeprazol 40 mg injeksi' })).toContainText(
      /✓ Diberikan/,
    );
  });

  test('observasi bertanggal dengan jam observasi berikutnya; askep shift pagi berbilah kemajuan', async ({
    page,
  }) => {
    await openAs(page, ['perawat'], `/klinis/rawat-inap/${ENCOUNTER_ID.endang}`);
    await page.getByRole('tab', { name: 'Observasi & EWS' }).click();
    const obs = page.getByRole('region', { name: 'Observasi dan EWS' });
    await expect(obs.getByRole('heading', { name: /^Observasi tanda vital · \d+ \w+$/ })).toBeVisible();
    await expect(obs.getByText(/Observasi berikutnya (\d{2}\.\d{2}|: pantau kontinu)/)).toBeVisible();

    await page.getByRole('tab', { name: 'Asuhan keperawatan' }).click();
    const askep = page.getByRole('region', { name: 'Asuhan keperawatan' });
    await expect(askep.getByRole('heading', { name: 'Intervensi keperawatan · shift pagi' })).toBeVisible();
    const bar = askep.getByRole('progressbar', { name: 'Kemajuan intervensi keperawatan' });
    const before = Number(await bar.getAttribute('aria-valuenow'));
    await askep.getByRole('checkbox', { checked: false }).first().check();
    await expect(bar).toHaveAttribute('aria-valuenow', String(before + 1));
  });

  test('CPPT: koreksi = versi baru beralasan, hanya oleh penulisnya; versi lama tetap tampil', async ({
    page,
  }) => {
    await openAs(page, ['perawat'], `/klinis/rawat-inap/${ENCOUNTER_ID.endang}`);
    const cppt = page.getByRole('region', { name: 'CPPT terintegrasi' });
    const notes = cppt.getByRole('list', { name: 'Catatan CPPT' }).getByRole('listitem');

    // Catatan PPA lain tidak bisa dikoreksi pengguna ini: hanya addendum (catatan asli tidak berubah).
    const other = notes.filter({ hasText: 'Edukasi pencegahan jatuh diulang ke keluarga' });
    await expect(other.getByRole('button', { name: /^Koreksi/ })).toHaveCount(0);
    await other.getByRole('button', { name: /^Addendum atas CPPT/ }).click();
    const add = cppt.getByRole('form', { name: 'Addendum CPPT' });
    await add.getByLabel(/S · Subjektif/).fill('Keluarga memahami edukasi');
    await add.getByLabel(/A · Asesmen/).fill('Risiko jatuh terkendali');
    await add.getByRole('button', { name: 'Simpan addendum' }).click();
    await expect(cppt.getByRole('status')).toContainText('Addendum tersimpan');
    await expect(notes.filter({ hasText: 'Keluarga memahami edukasi' })).toContainText(
      'Addendum atas catatan',
    );
    await expect(other).toContainText('Edukasi pencegahan jatuh diulang ke keluarga');

    // Catatan sendiri: koreksi wajib alasan, disimpan sebagai versi 2.
    await cppt.getByRole('button', { name: '+ Tulis CPPT (SOAP)' }).click();
    const form = cppt.getByRole('form', { name: 'Tulis CPPT baru' });
    await form.getByLabel(/S · Subjektif/).fill('Pusing ringan setelah bangun');
    await form.getByLabel(/O · Objektif/).fill('TD 150/90 · nadi 84');
    await form.getByLabel(/A · Asesmen/).fill('Risiko jatuh');
    await form.getByRole('button', { name: 'Simpan dan tanda tangani' }).click();
    await expect(cppt.getByRole('status')).toContainText('CPPT baru tersimpan');
    const mine = notes.filter({ hasText: 'TD 150/90 · nadi 84' });
    await mine.getByRole('button', { name: /^Koreksi CPPT/ }).click();
    const fix = cppt.getByRole('form', { name: 'Koreksi CPPT' });
    await fix.getByLabel(/O · Objektif/).fill('TD 130/90 · nadi 84');
    await fix.getByRole('button', { name: 'Simpan koreksi (versi baru)' }).click();
    await expect(fix.getByText(/^Alasan koreksi wajib/)).toBeVisible();
    await fix.getByLabel(/Alasan koreksi/).fill('Salah ketik tekanan darah sistolik');
    await fix.getByRole('button', { name: 'Simpan koreksi (versi baru)' }).click();
    await expect(cppt.getByRole('status')).toContainText(/Koreksi tersimpan .* sebagai versi 2/);

    await expect(notes.filter({ hasText: 'TD 130/90 · nadi 84' })).toContainText(
      'Versi 2 · koreksi: Salah ketik tekanan darah sistolik',
    );
    const old = notes.filter({ hasText: 'TD 150/90 · nadi 84' });
    await expect(old).toContainText('Versi lama · digantikan koreksi (tetap tersimpan)');
    await expect(old.getByRole('button', { name: /^Koreksi/ })).toHaveCount(0);
    await expectNoHorizontalScroll(page);

    // Bertahan + mengalir: catatan dan addendum tampil setelah muat ulang dan di layar CPPT (bagan RME).
    await page.reload();
    await expect(notes.filter({ hasText: 'Keluarga memahami edukasi' })).toContainText(
      'Addendum atas catatan',
    );
    await page.goto(`/klinis/cppt?pasien=${ENCOUNTER_ID.endang}`);
    const rme = page.getByRole('list', { name: 'Catatan CPPT' });
    await expect(rme.getByRole('listitem').filter({ hasText: 'TD 130/90 · nadi 84' })).toContainText(
      'Versi 2 · koreksi: Salah ketik tekanan darah sistolik',
    );
    await expect(rme.getByRole('listitem').filter({ hasText: 'Keluarga memahami edukasi' })).toBeVisible();
  });

  test('pasien skenario: pindai gelang membuka grid, lalu lima dosis 08.00 dicatat satu per satu', async ({
    page,
  }) => {
    const account = await createAccount({ roles: ['perawat'] });
    await loginAs(page, account, '/simulasi');
    await scenarioAt(page, 'IGD → rawat inap', 'Tn. Hartono Wibisono', 'Rawat inap');
    await page.goto(`/klinis/rawat-inap/${ENCOUNTER_ID.hartono}`);
    const journey = page.getByRole('region', { name: 'Perjalanan rawat (simulasi)' });
    const day1 = journey.getByRole('button', { name: 'Lompat ke hari 1 pagi' });
    await expect(day1).toBeDisabled();

    const emar = page.getByRole('region', { name: 'eMAR' });
    const due = emar.getByRole('button', { name: / jam 08\.00 · Jadwal/ });
    await expect(due).toHaveCount(5);
    await expect(due.first()).toBeDisabled();
    await emar.getByRole('button', { name: 'Pindai gelang', exact: true }).click();
    await expect(emar.getByText(/Pasien benar · gelang terpindai/)).toBeVisible();
    await expect(emar.getByText(/Dosis jam 08\.00: 0 dari 5 tercatat/)).toBeVisible();

    for (let i = 0; i < 5; i += 1) {
      const name = (await due.first().getAttribute('aria-label')) ?? '';
      await due.first().click();
      const panel = emar.getByRole('region', { name: /· jadwal 08\.00/ });
      const record = panel.getByRole('button', { name: 'Catat pemberian' });
      await expect(record).toBeDisabled();
      await panel.getByRole('button', { name: 'Pindai label obat' }).click();
      if (name.startsWith('Enoksaparin')) {
        // Obat kewaspadaan tinggi: belum bisa dicatat tanpa cek ganda perawat kedua.
        await expect(record).toBeDisabled();
        await panel.getByLabel(/Cek ganda: nama perawat kedua/).fill('Ns. Pemeriksa Kedua');
      }
      await record.click();
      await expect(due).toHaveCount(4 - i);
      if (i < 4) {
        // Dosis lain belum diberikan: tugas Simulasi belum selesai, lompat hari masih terkunci.
        await expect(emar.getByText(new RegExp(`Dosis jam 08\\.00: ${i + 1} dari 5 tercatat`))).toBeVisible();
        await expect(day1).toBeDisabled();
      }
    }
    // Dosis terakhir tercatat → tugas `emar` Simulasi selesai, hari berikutnya terbuka.
    await expect(journey).toContainText('Obat jadwal pertama tercatat per dosis');
    await expect(day1).toBeEnabled();
    await expect(emar.getByRole('list', { name: 'Pemberian tercatat' }).getByRole('listitem')).toHaveCount(5);
    await expectNoHorizontalScroll(page);
  });
});

test.describe('resume medis', () => {
  test('TTE terkunci sampai 12 butir lengkap, lalu final', async ({ page }) => {
    await openAs(page, ['dokter'], `/klinis/resume/${ENCOUNTER_ID.endang}`);
    await expect(
      page.getByRole('heading', { name: 'Resume medis · Ny. Endang Wijaya', level: 1 }),
    ).toBeVisible();
    const aside = page.getByRole('complementary', { name: 'Kelengkapan dan tanda tangan' });
    const tte = aside.getByRole('button', { name: 'Tanda tangani resume (TTE)' });
    await expect(tte).toBeDisabled();
    await expect(aside.getByText(/TTE terkunci: lengkapi 1 butir lagi/)).toBeVisible();
    await expect(page.getByText('perlu konfirmasi DPJP', { exact: true })).toBeVisible();

    await expect(page.getByRole('button', { name: 'Pratinjau PDF' })).toBeVisible();
    await expect(page.getByText(/batas resume final 24 jam setelah pulang/)).toBeVisible();
    await expect(page.getByText('dari eMAR', { exact: true })).toBeVisible();

    // Konfirmasi DPJP berjam dan bisa dibatalkan selama resume belum final.
    await page.getByRole('button', { name: 'Konfirmasi DPJP' }).click();
    await expect(page.getByText(/^dikonfirmasi DPJP · \d{2}\.\d{2}$/)).toBeVisible();
    await page.getByRole('button', { name: 'Batalkan konfirmasi' }).click();
    await expect(aside.getByText('11/12')).toBeVisible();
    await page.getByRole('button', { name: 'Konfirmasi DPJP' }).click();
    await expect(aside.getByText('12/12')).toBeVisible();
    const edukasi = aside.getByRole('checkbox', { name: 'Edukasi pasien terdokumentasi' });
    await edukasi.uncheck();
    await expect(tte).toBeDisabled();
    await edukasi.check();
    await expect(tte).toBeEnabled();
    await tte.click();
    await expect(aside.getByRole('status')).toContainText('Resume final · TTE');
    await expect(aside.getByText('Setelah final, perubahan hanya lewat addendum berversi.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Batalkan konfirmasi' })).toHaveCount(0);
    await expect(edukasi).toBeDisabled();
    await expectNoHorizontalScroll(page);
  });
});

test.describe('persetujuan tindakan (tablet)', () => {
  test('tujuh butir dipahami sebelum tanda tangan; penolakan wajib alasan', async ({ page }) => {
    await openAs(page, ['perawat'], `/tablet/persetujuan/${CONSENT_ID.hendro}`);
    const tablet = page.getByRole('region', { name: 'Tablet persetujuan tindakan' });
    await expect(tablet.getByRole('heading', { name: 'Pemasangan kateter vena sentral' })).toBeVisible();
    const next = tablet.getByRole('button', { name: 'Lanjut ke tanda tangan' });
    await expect(next).toBeDisabled();
    for (const box of await tablet.getByRole('checkbox', { name: /^Saya memahami/ }).all()) await box.check();
    await expect(next).toBeEnabled();

    // Tanda tangan pasien: nama ketik, keterangan menulis lokasi tablet; "Ulangi" menghapusnya selama langkah aktif.
    await next.click();
    const typed = tablet.getByLabel('Atau ketik nama lengkap sebagai tanda tangan').first();
    const name =
      (
        await tablet
          .getByText(/ · belum menandatangani$/)
          .first()
          .textContent()
      )?.split(' · ')[0] ?? '';
    await typed.fill(name);
    await tablet.getByRole('button', { name: 'Pakai nama ketik' }).first().click();
    await expect(tablet.getByText(/ · nama diketik · \d{2}\.\d{2} · lokasi tablet: /)).toBeVisible();
    await expect(tablet.getByText('Nama dan hubungan:')).toBeVisible();
    await tablet.getByRole('button', { name: 'Ulangi tanda tangan pasien/keluarga' }).click();
    await expect(tablet.getByRole('button', { name: 'Lanjut ke saksi' })).toBeDisabled();

    await tablet.getByRole('button', { name: 'Saya menolak tindakan' }).click();
    const form = tablet.getByRole('region', { name: 'Konfirmasi penolakan' });
    await form.getByRole('button', { name: 'Catat penolakan' }).click();
    await expect(form.getByRole('alert')).toContainText('Alasan penolakan wajib diisi');
    await form
      .getByRole('textbox', { name: /Alasan penolakan/ })
      .fill('Ingin berdiskusi dengan keluarga besar dulu');
    await form.getByRole('button', { name: 'Catat penolakan' }).click();
    await expect(tablet.getByRole('status').filter({ hasText: 'Pasien menolak tindakan' })).toBeVisible();
    await expect(tablet.getByText('Status: Ditolak pasien')).toBeVisible();
    await expect(tablet.getByRole('button', { name: 'Saya menolak tindakan' })).toBeDisabled();
    await expect(tablet.getByRole('checkbox', { name: /^Saya memahami/ }).first()).toBeDisabled();
  });

  test('persetujuan Tn. Hartono menunggu giliran; pada gilirannya TTE dokter memajukan simulasi', async ({
    page,
  }) => {
    const account = await createAccount({ roles: ['dokter'] });
    await loginAs(page, account, '/simulasi');
    await scenarioAt(page, 'IGD → rawat inap', 'Tn. Hartono Wibisono', 'Tata laksana');

    // Langkah tata laksana dimulai tetapi tugas persetujuan belum gilirannya: tablet hanya bisa dibaca.
    await page.goto(`/tablet/persetujuan/${CONSENT_ID.hartono}`);
    const tablet = page.getByRole('region', { name: 'Tablet persetujuan tindakan' });
    await expect(
      tablet.getByRole('status').filter({ hasText: 'Menunggu giliran persetujuan di Simulasi.' }),
    ).toBeVisible();
    await expect(tablet.getByRole('checkbox', { name: /^Saya memahami/ }).first()).toBeDisabled();
    await expect(tablet.getByRole('button', { name: 'Saya menolak tindakan' })).toBeDisabled();
    await expect(tablet.getByRole('button', { name: 'Lanjut', exact: true })).toBeDisabled();

    // Tugas sebelumnya di langkah itu selesai → giliran persetujuan; pintu tablet langsung membuka dokumennya.
    await page.goto('/simulasi');
    await page.getByRole('button', { name: /^Kalsium glukonat IV \+ insulin/ }).click();
    await page.getByRole('button', { name: /^Ganti omeprazol ke pantoprazol/ }).click();
    await page.getByRole('button', { name: /^ICU\/ICCU/ }).click();
    await expect(page.getByRole('button', { name: 'Tanda tangani', exact: true })).toBeEnabled();
    await page.goto('/tablet/persetujuan');
    await expect(page).toHaveURL(new RegExp(`/tablet/persetujuan/${CONSENT_ID.hartono}$`));
    await expect(tablet.getByText('Status: Menunggu tanda tangan')).toBeVisible();
    for (const box of await tablet.getByRole('checkbox', { name: /^Saya memahami/ }).all()) await box.check();
    await tablet.getByRole('button', { name: 'Lanjut ke tanda tangan' }).click();
    const typed = tablet.getByLabel('Atau ketik nama lengkap sebagai tanda tangan');
    await typed.first().fill('Hartono Wibisono');
    await tablet.getByRole('button', { name: 'Pakai nama ketik' }).first().click();
    await tablet.getByRole('button', { name: 'Lanjut ke saksi' }).click();
    await typed.last().fill('Wening Wibisono');
    await tablet.getByRole('button', { name: 'Pakai nama ketik' }).last().click();
    await tablet.getByRole('checkbox', { name: /^Saksi kedua \(petugas\)/ }).check();
    await tablet.getByRole('button', { name: 'Lanjut ke TTE dokter' }).click();
    await tablet.getByRole('button', { name: 'Tanda tangani (TTE)' }).click();
    await expect(tablet.getByRole('status').filter({ hasText: 'Dokumen final · TTE' })).toBeVisible();

    // Keadaan dari server (tugas skenario tercatat): setelah dimuat ulang tetap final dan terkunci.
    await page.reload();
    await expect(tablet.getByText('Status: Final · TTE')).toBeVisible();
    await expect(tablet.getByRole('button', { name: 'Saya menolak tindakan' })).toBeDisabled();
    await expect(tablet.getByRole('button', { name: 'Dokumen final' })).toBeDisabled();
  });

  test('persetujuan operasi Ny. Ratna menunggu SEP admisi, lalu final dan hanya bisa dibaca', async ({
    page,
  }) => {
    await openAs(page, ['perawat'], `/tablet/persetujuan/${CONSENT_ID.ratna}`);
    const tablet = page.getByRole('region', { name: 'Tablet persetujuan tindakan' });
    await expect(
      tablet
        .getByRole('status')
        .filter({ hasText: 'final bersama SEP rawat inap pada langkah Admisi elektif' }),
    ).toBeVisible();
    await expect(tablet.getByText('Status: Menunggu tanda tangan')).toBeVisible();
    await expect(tablet.getByRole('checkbox', { name: /^Saya memahami/ }).first()).toBeDisabled();
    await expect(tablet.getByRole('button', { name: 'Saya menolak tindakan' })).toBeDisabled();

    await scenarioAt(page, 'Elektif · TPDI × BTN', 'Ny. Ratna Sari', 'Deposit via TPDI');
    await page.goto(`/tablet/persetujuan/${CONSENT_ID.ratna}`);
    await expect(tablet.getByText('Status: Final · TTE')).toBeVisible();
    await expect(tablet.getByRole('status').filter({ hasText: 'Menunggu' })).toHaveCount(0);
    const first = tablet.getByRole('checkbox', { name: /^Saya memahami/ }).first();
    await expect(first).toBeChecked();
    await expect(first).toBeDisabled();
    await expect(tablet.getByRole('button', { name: 'Saya menolak tindakan' })).toBeDisabled();
    await expect(tablet.getByRole('button', { name: 'Dokumen final' })).toBeDisabled();
  });
});

/**
 * Toko demo bersama (ADR-0085): aksi klinis bertahan setelah muat ulang dan mengalir ke layar terkait (papan IGD ↔
 * tempat tidur ↔ rawat inap; resume final → bed pasien bisa dilepas; persetujuan ditolak bertahan).
 */
test.describe('aliran antarlayar klinis', () => {
  test('IGD minta bed → papan tempat tidur → IGD dan rawat inap mencerminkan → pasien tiba', async ({
    page,
  }) => {
    const akun = await createAccount({ roles: ['dokter', 'perawat'] });
    await loginWithPosition(page, akun, 'Dokter (DPJP)', '/klinis/igd');
    await page.goto('/klinis/igd');
    const board = page.getByRole('region', { name: 'Papan pasien IGD' });
    await board.getByRole('button', { name: /Tn\. Joko Susilo/ }).click();
    const disp = page.getByRole('region', { name: 'Disposisi pasien IGD' });
    await disp.getByLabel('Kelas ruang').selectOption('Kelas 2');
    await disp.getByLabel('Kebutuhan ruang').fill('Ortopedi · pantau nyeri lutut');
    await disp.getByRole('button', { name: 'Minta bed rawat inap' }).click();
    await expect(disp.getByRole('status')).toContainText(
      'Permintaan bed Kelas 2 terkirim ke papan tempat tidur',
    );

    // Bertahan setelah muat ulang.
    await page.reload();
    await board.getByRole('button', { name: /Tn\. Joko Susilo/ }).click();
    await expect(disp).toContainText('Permintaan bed sudah di papan tempat tidur');
    await expect(board.getByRole('button', { name: /Tn\. Joko Susilo/ })).toContainText('Tunggu bed');

    // Mengalir: permintaan tampil di papan tempat tidur; perawat mengalokasikan bed.
    await switchPosition(page, 'Perawat');
    await page.goto('/klinis/tempat-tidur');
    const requests = page.getByRole('region', { name: 'Permintaan bed' });
    const joko = requests.getByRole('listitem').filter({ hasText: 'Tn. Joko Susilo' });
    await expect(joko).toContainText('IGD B6');
    await joko
      .getByRole('button', { name: /^Tampilkan bed M-\d+ di peta/ })
      .first()
      .click();
    const code = (
      (await page
        .getByRole('region', { name: 'Bed terpilih' })
        .locator('.font-mono')
        .first()
        .textContent()) ?? ''
    ).trim();
    await requests.getByRole('button', { name: `Alokasikan Tn. Joko ke bed ${code}` }).click();
    await expect(requests.getByRole('status')).toContainText(`Tn. Joko dialokasikan ke ${code} · dipesan`);
    await expect(requests.getByRole('listitem').filter({ hasText: 'Tn. Joko Susilo' })).toHaveCount(0);

    // IGD dan rawat inap menampilkan bed yang dialokasikan.
    await page.goto('/klinis/igd');
    await board.getByRole('button', { name: /Tn\. Joko Susilo/ }).click();
    await expect(disp).toContainText(`Bed ${code}`);
    await page.goto('/klinis/rawat-inap');
    const masuk = page.getByRole('region', { name: 'Masuk dari IGD' });
    await expect(masuk).toContainText('Tn. Joko Susilo');
    await expect(masuk).toContainText(/Bed dipesan \d{2}\.\d{2} · menunggu transfer/);

    // Pasien tiba di bangsal: bed terisi, keluar dari papan IGD, rawat inap mencatat kedatangan.
    await page.goto(`/klinis/tempat-tidur?bangsal=melati`);
    await page
      .getByRole('region', { name: 'Peta Bangsal Melati' })
      .getByRole('button', { name: new RegExp(code) })
      .click();
    await page
      .getByRole('region', { name: 'Bed terpilih' })
      .getByRole('button', { name: 'Pasien tiba · tandai terisi' })
      .click();
    await expect(page.getByRole('region', { name: 'Permintaan bed' }).getByRole('status')).toContainText(
      `${code} · terisi`,
    );
    await page.goto('/klinis/rawat-inap');
    await expect(masuk).toContainText(/Tiba di bangsal \d{2}\.\d{2}/);
    await page.goto('/klinis/igd');
    await expect(board.getByRole('button', { name: /Tn\. Joko Susilo/ })).toHaveCount(0);
  });

  test('disposisi meninggal (K-1): hanya dokter penanggung jawab, sebab ICD-10, SKK ber-TTE; admisi ditolak', async ({
    page,
  }) => {
    await openAs(page, ['dokter'], '/klinis/igd');
    const board = page.getByRole('region', { name: 'Papan pasien IGD' });
    await board.getByRole('button', { name: /Tn\. Ahmad Fauzi/ }).click();
    const disp = page.getByRole('region', { name: 'Disposisi pasien IGD' });
    await expect(disp).toContainText(
      'Hanya dokter penanggung jawab pasien ini yang dapat menyatakan meninggal.',
    );
    await disp.getByRole('button', { name: 'Tangani sebagai dokter penanggung jawab' }).click();
    await expect(disp.getByRole('status')).toContainText('kini dokter penanggung jawab');
    await disp.getByRole('button', { name: 'Nyatakan meninggal' }).click();
    const form = disp.getByRole('form', { name: 'Pernyataan meninggal' });
    await expect(form).toContainText('menunggu konfirmasi pemilik produk');
    const save = form.getByRole('button', { name: 'Simpan pernyataan meninggal' });
    await form.getByLabel('Jam kematian (HH.MM)').fill('10.40');
    await form.getByLabel('Sebab kematian (ICD-10)').selectOption('I21.4');
    await expect(save).toBeDisabled();
    await form.getByLabel(/Tanda tangani surat keterangan kematian/).check();
    await save.click();
    const deaths = page.getByRole('region', { name: 'Disposisi meninggal hari ini' });
    await expect(deaths).toContainText('Tn. Ahmad Fauzi');
    await expect(deaths).toContainText(
      /I21\.4 Infark miokard akut non-ST elevasi · surat keterangan kematian SKK\/RSFA\/0001/,
    );
    await expect(board.getByRole('button', { name: /Tn\. Ahmad Fauzi/ })).toHaveCount(0);
    await page.reload();
    await expect(deaths).toContainText('Tn. Ahmad Fauzi');
  });

  test('resume final (TTE DPJP) membuka pemulangan di papan tempat tidur', async ({ page }) => {
    const akun = await createAccount({ roles: ['dokter', 'perawat'] });
    await loginWithPosition(page, akun, 'Perawat', '/klinis/tempat-tidur');
    await page.goto('/klinis/tempat-tidur?bangsal=melati');
    const melati = page.getByRole('region', { name: 'Peta Bangsal Melati' });
    const detail = page.getByRole('region', { name: 'Bed terpilih' });
    const status = page.getByRole('region', { name: 'Permintaan bed' }).getByRole('status');
    await melati.getByRole('button', { name: /M-203/ }).click();
    await detail.getByRole('button', { name: 'Pasien sudah pulang' }).click();
    await expect(status).toContainText('Resume medis pasien belum final');

    await switchPosition(page, 'Dokter (DPJP)');
    await page.goto(`/klinis/resume/${ENCOUNTER_ID.endang}`);
    const aside = page.getByRole('complementary', { name: 'Kelengkapan dan tanda tangan' });
    await page.getByRole('button', { name: 'Konfirmasi DPJP' }).click();
    await expect(aside.getByText('12/12')).toBeVisible();
    await aside.getByRole('button', { name: 'Tanda tangani resume (TTE)' }).click();
    await expect(aside.getByRole('status')).toContainText('Resume final · TTE');
    await page.reload();
    await expect(aside.getByRole('status')).toContainText('Resume final · TTE');

    await switchPosition(page, 'Perawat');
    await page.goto('/klinis/tempat-tidur?bangsal=melati');
    await melati.getByRole('button', { name: /M-203/ }).click();
    await detail.getByRole('button', { name: 'Pasien sudah pulang' }).click();
    await expect(status).toContainText(/M-203 · kotor \d{2}\.\d{2}/);
    await page.goto('/klinis/rawat-inap');
    await expect(page.getByRole('region', { name: 'Pulang hari ini' })).toContainText('Ny. Endang Wijaya');
    await expect(
      page
        .getByRole('region', { name: 'Daftar pasien rawat inap' })
        .getByRole('link', { name: /Ny\. Endang Wijaya/ }),
    ).toHaveCount(0);
  });

  test('persetujuan ditolak bertahan setelah muat ulang (alasan tercatat)', async ({ page }) => {
    await openAs(page, ['perawat'], `/tablet/persetujuan/${CONSENT_ID.hendro}`);
    const tablet = page.getByRole('region', { name: 'Tablet persetujuan tindakan' });
    await tablet.getByRole('button', { name: 'Saya menolak tindakan' }).click();
    const form = tablet.getByRole('region', { name: 'Konfirmasi penolakan' });
    await form.getByRole('textbox', { name: /Alasan penolakan/ }).fill('Ingin pendapat dokter lain dulu');
    await form.getByRole('button', { name: 'Catat penolakan' }).click();
    await expect(tablet.getByText('Status: Ditolak pasien')).toBeVisible();
    await page.reload();
    await expect(tablet.getByText('Status: Ditolak pasien')).toBeVisible();
    await expect(
      tablet.getByRole('status').filter({ hasText: 'alasan: Ingin pendapat dokter lain dulu' }),
    ).toBeVisible();
    await expect(tablet.getByRole('button', { name: 'Saya menolak tindakan' })).toBeDisabled();
  });
});
