import { expect, type Page, test } from '@playwright/test';
import { createAccount, loginAs } from '../support/accounts';

/**
 * FE1 · Layar demo platform fase 1–2 dan operasional fase 10 (mode presentasi, ADR-0023): alur utama tiap layar
 * diklik sampai umpan balik berjam muncul. Tidak ada yang disimpan; tiap tes memakai akun baru.
 */

async function expectNoHorizontalOverflow(page: Page) {
  const { overflow, offenders } = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const offenders = [...document.querySelectorAll('body *')]
      .filter((el) => el.getBoundingClientRect().right > width + 0.5)
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()}.${el.className}`.slice(0, 120));
    return { overflow: document.documentElement.scrollWidth - width, offenders };
  });
  expect(overflow, `scroll horizontal oleh: ${offenders.join(' | ')}`).toBeLessThanOrEqual(0);
}

const JAM = /\d{2}\.\d{2}/;

test.describe('FE1 · platform dan operasional', () => {
  test('struktur RS: telusur ke kamar, tambah kamar berkelas, nonaktifkan berkonfirmasi + alasan', async ({
    page,
  }) => {
    const admin = await createAccount({ roles: ['admin_tenant'] });
    await loginAs(page, admin, '/sistem/struktur');
    await expect(
      page.getByRole('heading', { name: 'Struktur RS · faskes sampai bed', level: 1 }),
    ).toBeVisible();

    // Bangsal Melati terpilih: tidak bisa dinonaktifkan karena bed terisi (alasan tertulis).
    const detail = page.getByRole('region', { name: 'Unit · Bangsal Melati' });
    await expect(detail.getByRole('button', { name: 'Nonaktifkan' })).toBeDisabled();
    await expect(detail.getByText(/10 bed masih terisi pasien/)).toBeVisible();

    await detail.getByRole('button', { name: 'Buka Melati lantai 3' }).click();
    const ruang = page.getByRole('region', { name: 'Ruang · Melati lantai 3' });
    await ruang.getByRole('button', { name: 'Tambah kamar' }).click();
    const form = ruang.getByRole('form', { name: 'Tambah kamar di Melati lantai 3' });
    await form.getByLabel('Kode').fill('M-214');
    await form.getByLabel('Nama').fill('Kamar M-214');
    await form.getByLabel('Kelas rawat *').selectOption('');
    await form.getByRole('button', { name: 'Simpan kamar' }).click();
    await expect(form.getByText('Kamar rawat inap wajib punya kelas rawat')).toBeVisible();
    await form.getByLabel('Kelas rawat *').selectOption('kelas_2');
    await form.getByRole('button', { name: 'Simpan kamar' }).click();
    await expect(ruang.getByRole('status')).toContainText(/Kamar M-214 ditambahkan · \d{2}\.\d{2}/);
    await expect(ruang.getByRole('cell', { name: 'M-214', exact: true })).toBeVisible();

    // Kamar kosong M-212: nonaktifkan dengan alasan wajib.
    await ruang.getByRole('button', { name: 'Buka Kamar M-212' }).click();
    const kamar = page.getByRole('region', { name: 'Kamar · Kamar M-212' });
    await kamar.getByRole('button', { name: 'Nonaktifkan' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Nonaktifkan kamar Kamar M-212?' });
    const yes = dialog.getByRole('button', { name: 'Ya, nonaktifkan' });
    await expect(yes).toBeDisabled();
    await dialog.getByLabel('Alasan menonaktifkan').fill('Renovasi kamar mandi sampai 20 Okt');
    await yes.click();
    await expect(kamar.getByRole('status')).toContainText(JAM);
    await expect(kamar.getByRole('button', { name: 'Aktifkan kembali' })).toBeEnabled();
    await expect(page.getByRole('list', { name: 'Riwayat perubahan struktur' })).toContainText(
      'Renovasi kamar mandi sampai 20 Okt',
    );
    await expectNoHorizontalOverflow(page);
  });

  test('pengaturan RS: modul bergerbang dependensi, pengaturan tervalidasi, template terbit versi baru', async ({
    page,
  }) => {
    const admin = await createAccount({ roles: ['admin_tenant'] });
    await loginAs(page, admin, '/sistem/pengaturan');
    await expect(
      page.getByRole('heading', { name: 'Pengaturan RS · modul, aturan, dan template cetak', level: 1 }),
    ).toBeVisible();

    // Modul: Lab dipakai modul lain (terkunci beralasan); Gizi dimatikan, Bank darah dinyalakan, lalu disimpan.
    const lab = page.getByRole('switch', { name: 'S01 Laboratorium patologi klinik' });
    await expect(lab).toBeDisabled();
    await expect(page.getByText(/Dipakai modul aktif .*S02/)).toBeVisible();
    await page.getByRole('switch', { name: 'S07 Gizi' }).click();
    await page.getByRole('switch', { name: 'S08 Bank darah' }).click();
    const pendingBar = page.getByRole('region', { name: 'Perubahan belum disimpan' });
    await expect(pendingBar).toContainText('2 perubahan belum disimpan: S07 → mati, S08 → aktif');
    await pendingBar.getByRole('button', { name: 'Simpan perubahan' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Simpan 2 perubahan modul?' });
    await dialog.getByLabel('Alasan perubahan').fill('Bank darah mulai memakai SIM RS 12 Okt');
    await dialog.getByRole('button', { name: 'Ya, simpan' }).click();
    await expect(pendingBar.getByRole('status')).toContainText(/Tersimpan · \d{2}\.\d{2} · 2 modul berubah/);

    // Pengaturan umum: nilai di luar batas skema ditolak, lalu disimpan.
    await page.getByRole('tab', { name: 'Pengaturan umum' }).click();
    const umum = page.getByRole('form', { name: 'Pengaturan umum' });
    const idle = umum.getByLabel('Batas sesi idle (menit)');
    await idle.fill('90');
    await expect(umum.getByText('Maksimal 60')).toBeVisible();
    await expect(umum.getByRole('button', { name: 'Simpan pengaturan' })).toBeDisabled();
    await idle.fill('20');
    await umum.getByRole('button', { name: 'Simpan pengaturan' }).click();
    await expect(umum.getByRole('status')).toContainText(/Tersimpan · \d{2}\.\d{2} · 1 pengaturan berubah/);

    // Template cetak: gelang tanpa alergi diblok; kop diubah lalu terbit versi 5.
    await page.getByRole('tab', { name: 'Template cetak' }).click();
    const editor = page.getByRole('region', { name: 'Ubah Gelang pasien dewasa' });
    await editor.getByLabel('Penanda alergi').uncheck();
    await expect(editor.getByText('Gelang pasien wajib menampilkan penanda alergi.')).toBeVisible();
    await expect(editor.getByRole('button', { name: 'Terbitkan versi 5' })).toBeDisabled();
    await editor.getByLabel('Penanda alergi').check();
    await editor.getByLabel('Catatan kaki').fill('Gelang jangan dilepas selama dirawat');
    await expect(page.getByRole('img', { name: 'Pratinjau Gelang pasien dewasa (draf)' })).toContainText(
      'ALERGI: Amoksisilin',
    );
    await editor.getByRole('button', { name: 'Terbitkan versi 5' }).click();
    const publish = page.getByRole('alertdialog', { name: 'Terbitkan Gelang pasien dewasa versi 5?' });
    await publish.getByLabel('Catatan perubahan').fill('Catatan kaki gelang ditambahkan');
    await publish.getByRole('button', { name: 'Terbitkan versi 5' }).click();
    await expect(
      page.getByRole('region', { name: 'Ubah Gelang pasien dewasa' }).getByRole('status'),
    ).toContainText(/Versi 5 terbit · \d{2}\.\d{2}/);
    await expectNoHorizontalOverflow(page);
  });

  test('data rujukan: cari tahan salah ketik, impor CSV uji kering gagal tertutup lalu terapkan', async ({
    page,
  }) => {
    const admin = await createAccount({ roles: ['admin_tenant'] });
    await loginAs(page, admin, '/sistem/terminologi');
    await expect(
      page.getByRole('heading', { name: 'Data rujukan · kode baku dan impor versi', level: 1 }),
    ).toBeVisible();

    const results = page.getByRole('list', { name: 'Hasil pencarian kode' });
    await expect(results).toContainText('J18.9');
    await expect(results).toContainText('ejaan mirip');
    await page.getByLabel('Kode atau kata kunci').fill('troponin');
    await page.getByRole('radio', { name: 'LOINC' }).click();
    await expect(page.getByText('Tidak ada kode yang cocok.')).toBeVisible();

    await page.getByRole('tab', { name: 'Impor CSV' }).click();
    await page.getByRole('button', { name: /loinc-2\.77-lab-rsfa\.csv/ }).click();
    await page.getByRole('button', { name: 'Jalankan uji kering' }).click();
    await expect(page.getByRole('list', { name: 'Galat impor' })).toContainText(
      'kode 2823-3 muncul lebih dari sekali',
    );
    await expect(page.getByRole('button', { name: 'Terapkan impor' })).toBeDisabled();

    await page.getByRole('button', { name: /loinc-2\.77-lab-rsfa-perbaikan\.csv/ }).click();
    await page.getByRole('button', { name: 'Jalankan uji kering' }).click();
    const summary = page.getByRole('region', { name: 'Ringkasan uji kering' });
    await expect(summary.getByText('Kode baru')).toBeVisible();
    await page.getByRole('button', { name: 'Terapkan impor' }).click();
    await page
      .getByRole('alertdialog', { name: 'Terapkan loinc-2.77-lab-rsfa-perbaikan.csv?' })
      .getByRole('button', { name: 'Ya, terapkan' })
      .click();
    await expect(page.getByText(/Diterapkan · \d{2}\.\d{2} · LOINC versi 2\.77-contoh/)).toBeVisible();

    await page.getByRole('tab', { name: 'Cari kode' }).click();
    await expect(results).toContainText('10839-9');
    await page.getByRole('tab', { name: 'Riwayat versi' }).click();
    await expect(page.getByRole('region', { name: 'Riwayat versi data rujukan' })).toContainText(
      'Anda (sesi ini)',
    );
    await expectNoHorizontalOverflow(page);
  });
});
