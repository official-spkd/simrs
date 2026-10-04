import { expect, type Page, test } from '@playwright/test';
import { createAccount, loginAs } from '../support/accounts';

/**
 * IGD, tempat tidur, rawat inap, resume, dan persetujuan tindakan (mode presentasi, ADR-0023; mockup IGD,
 * BedManagement, Ranap, Resume, Consent). Akun baru = keadaan simulasi baru (semua skenario di langkah awal).
 */

async function openAs(page: Page, roles: string[], path: string) {
  const account = await createAccount({ roles });
  await loginAs(page, account, path);
  await page.goto(path);
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
    await expect(
      panel.getByRole('alert').filter({ hasText: 'Level 3 di bawah saran sistem (triase 2)' }),
    ).toBeVisible();

    await panel.getByRole('button', { name: 'Tetap lanjut dengan alasan klinis' }).click();
    const reason = panel.getByRole('textbox', { name: /Alasan klinis \(wajib/ });
    await reason.fill('Membaik');
    await expect(panel.getByRole('button', { name: 'Simpan alasan dan lanjut' })).toBeDisabled();
    await reason.fill('Kekuatan motorik kembali penuh, bicara jelas');
    await panel.getByRole('button', { name: 'Simpan alasan dan lanjut' }).click();
    await expect(panel.getByText(/Override tercatat/)).toBeVisible();
    await expect(save).toBeEnabled();
    await save.click();
    await expect(
      panel.getByRole('status').filter({ hasText: /Triase 3 tersimpan .*\(simulasi, tidak disimpan\)/ }),
    ).toBeVisible();
    await expect(board.getByRole('button', { name: /Ny\. Lestiani Hapsari/ })).toContainText('3 · Urgen');
    await expectNoHorizontalScroll(page);
  });
});

test.describe('tempat tidur', () => {
  test('ubin status bertulisan, filter bangsal/status, alokasi bed ke permintaan', async ({ page }) => {
    await openAs(page, ['perawat'], '/klinis/tempat-tidur');
    await expect(page.getByRole('heading', { name: 'Manajemen tempat tidur', level: 1 })).toBeVisible();
    const tiles = page.getByRole('region', { name: 'Ringkasan status bed' });
    for (const t of ['Terisi', 'Siap pakai', 'Dipesan', 'Kotor · dibersihkan', 'Rusak']) {
      await expect(tiles.getByText(t, { exact: true })).toBeVisible();
    }

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
    await emar.getByRole('button', { name: 'Pindai gelang', exact: true }).click();
    await expect(emar.getByText(/Pasien benar · gelang terpindai/)).toBeVisible();
    await expect(dose).toBeEnabled();
    await dose.click();
    await expect(emar.getByText('Pemberian tercatat shift ini')).toBeVisible();

    // Dosis terlambat wajib alasan.
    await emar.getByRole('button', { name: /^Omeprazol 40 mg injeksi jam 08\.00/ }).click();
    const late = emar.getByRole('button', { name: 'Catat pemberian terlambat' });
    await expect(late).toBeDisabled();
    await emar.getByLabel(/Alasan keterlambatan/).fill('Pasien sedang foto toraks di radiologi');
    await late.click();
    await expect(emar.getByText(/terlambat · Pasien sedang foto toraks/)).toBeVisible();

    // CPPT: S dan A wajib; koreksi disimpan sebagai versi baru.
    const cppt = page.getByRole('region', { name: 'CPPT terintegrasi' });
    await cppt.getByRole('button', { name: '+ Tulis CPPT (SOAP)' }).click();
    await cppt.getByRole('button', { name: 'Simpan dan tanda tangani' }).click();
    await expect(cppt.getByText('S wajib diisi.')).toBeVisible();
    await expect(cppt.getByText('Versi 2 · koreksi: Salah ketik nilai SpO2')).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
});

test.describe('resume medis', () => {
  test('TTE terkunci sampai 12 butir lengkap, lalu final', async ({ page }) => {
    await openAs(page, ['dokter'], '/klinis/resume/kj-endang');
    await expect(
      page.getByRole('heading', { name: 'Resume medis · Ny. Endang Wijaya', level: 1 }),
    ).toBeVisible();
    const aside = page.getByRole('complementary', { name: 'Kelengkapan dan tanda tangan' });
    const tte = aside.getByRole('button', { name: 'Tanda tangani resume (TTE)' });
    await expect(tte).toBeDisabled();
    await expect(aside.getByText(/TTE terkunci: lengkapi 1 butir lagi/)).toBeVisible();
    await expect(page.getByText('Sumber: perlu konfirmasi DPJP')).toBeVisible();

    await page.getByRole('button', { name: 'Konfirmasi DPJP' }).click();
    await expect(aside.getByText('12/12')).toBeVisible();
    const edukasi = aside.getByRole('checkbox', { name: 'Edukasi pasien terdokumentasi' });
    await edukasi.uncheck();
    await expect(tte).toBeDisabled();
    await edukasi.check();
    await expect(tte).toBeEnabled();
    await tte.click();
    await expect(aside.getByRole('status')).toContainText('Resume final · TTE');
    await expect(edukasi).toBeDisabled();
    await expectNoHorizontalScroll(page);
  });
});

test.describe('persetujuan tindakan (tablet)', () => {
  test('tujuh butir dipahami sebelum tanda tangan; penolakan wajib alasan', async ({ page }) => {
    await openAs(page, ['perawat'], '/tablet/persetujuan/pk-hendro');
    const tablet = page.getByRole('region', { name: 'Tablet persetujuan tindakan' });
    await expect(tablet.getByRole('heading', { name: 'Pemasangan kateter vena sentral' })).toBeVisible();
    const next = tablet.getByRole('button', { name: 'Lanjut ke tanda tangan' });
    await expect(next).toBeDisabled();
    for (const box of await tablet.getByRole('checkbox', { name: /^Saya memahami/ }).all()) await box.check();
    await expect(next).toBeEnabled();

    await tablet.getByRole('button', { name: 'Saya menolak tindakan' }).click();
    const form = tablet.getByRole('region', { name: 'Konfirmasi penolakan' });
    await form.getByRole('button', { name: 'Catat penolakan' }).click();
    await expect(form.getByRole('alert')).toContainText('Alasan penolakan wajib diisi');
    await form
      .getByRole('textbox', { name: /Alasan penolakan/ })
      .fill('Ingin berdiskusi dengan keluarga besar dulu');
    await form.getByRole('button', { name: 'Catat penolakan' }).click();
    await expect(tablet.getByRole('status').filter({ hasText: 'Pasien menolak tindakan' })).toBeVisible();
    await expect(tablet.getByRole('button', { name: 'Saya menolak tindakan' })).toBeDisabled();
  });
});
