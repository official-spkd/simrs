import { loginRole, sharedAccount, resetShared, switchRole } from './penunjang-support';
import { expect, type Locator, type Page, test } from '@playwright/test';
import { createAccount, loginAs } from '../support/accounts';
import { LAB_SAMPLE_ID, RAD_EXAM_ID } from '../../src/lib/demo/fixtures/ids';

/** Layar penunjang mode presentasi (ADR-0023): laboratorium, farmasi, radiologi. */

async function jumpTo(page: Page, scenarioTab: string | null, stage: string) {
  await page.goto('/simulasi');
  if (scenarioTab) await page.getByRole('tab', { name: scenarioTab }).click();
  await page.getByText('Lompat ke tahap', { exact: true }).click();
  await page.getByRole('button', { name: new RegExp(`^\\d+\\. ${stage}$`) }).click();
  await expect(page.getByText(new RegExp(`Langkah \\d+ dari \\d+ · ${stage}`))).toBeVisible();
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe('penunjang · laboratorium', () => {
  test('worklist dan hasil ber-LOINC; nilai kritis wajib penerima dan read-back; validasi berurutan', async ({
    page,
  }) => {
    const analis = await createAccount({ roles: ['analis_lab', 'dokter'] });
    await loginRole(page, analis, 'Analis laboratorium');
    await page.goto('/penunjang/lab');
    await expect(
      page.getByRole('heading', { name: 'Laboratorium · validasi hasil', level: 1 }),
    ).toBeVisible();
    const worklist = page.getByRole('region', { name: 'Worklist' });
    await expect(worklist.getByText('L2610050142')).toBeVisible();

    await worklist.getByRole('button', { name: /Ny\. Endang Wijaya/ }).click();
    await expect(page).toHaveURL(new RegExp(`pilih=${LAB_SAMPLE_ID.endang}`));
    const hasil = page.getByRole('region', { name: 'Hasil pemeriksaan' });
    await expect(hasil.getByText('LOINC 2160-0')).toBeVisible();
    await expect(hasil.getByRole('row', { name: /Kreatinin/ })).toContainText('H Δ');

    // Nilai kritis: tidak bisa disimpan tanpa penerima dan read-back.
    const kritis = page.getByRole('region', { name: /Nilai kritis terbuka · Tn\. Yusuf Hidayat/ });
    await expect(kritis.getByRole('timer')).toHaveText(/^\d{2}:\d{2}$/);
    await kritis.getByRole('button', { name: 'Catat pelaporan' }).click();
    await kritis.getByRole('button', { name: 'Simpan pelaporan' }).click();
    await expect(kritis.getByText('Nama penerima wajib diisi (minimal 5 karakter).')).toBeVisible();
    await expect(kritis.getByText('Read-back wajib dikonfirmasi sebelum disimpan.')).toBeVisible();
    await kritis
      .getByRole('textbox', { name: 'Nama penerima laporan (DPJP / dokter jaga)' })
      .fill('dr. Sinta Maharani, Sp.PD-KGH');
    await kritis.getByRole('button', { name: 'Simpan pelaporan' }).click();
    await expect(kritis.getByText('Read-back wajib dikonfirmasi sebelum disimpan.')).toBeVisible();
    const kpi = page.getByRole('region', { name: 'Indikator laboratorium' });
    await expect(kpi.getByText('belum dilaporkan dengan read-back')).toBeVisible();
    await kritis.getByRole('checkbox', { name: /Read-back/ }).check();
    await kritis.getByRole('button', { name: 'Simpan pelaporan' }).click();
    const dilaporkan = page.getByRole('region', { name: /Nilai kritis dilaporkan · Tn\. Yusuf Hidayat/ });
    await expect(dilaporkan).toContainText('read-back terkonfirmasi');
    // Tersimpan di toko demo bersama (ADR-0085): tanpa label simulasi, dan tetap ada setelah dimuat ulang.
    await expect(dilaporkan).toContainText('Diterima dr. Sinta Maharani, Sp.PD-KGH');
    await expect(dilaporkan).not.toContainText('tidak disimpan');
    await expect(kpi.getByText('semua sudah dilaporkan')).toBeVisible();
    await page.reload();
    await expect(dilaporkan).toContainText('Diterima dr. Sinta Maharani, Sp.PD-KGH');
    await expect(kpi.getByText('semua sudah dilaporkan')).toBeVisible();

    // Validasi teknis lalu klinis (TTE Sp.PK).
    await worklist.getByRole('button', { name: /Ny\. Endang Wijaya/ }).click();
    await hasil.getByRole('button', { name: 'Validasi teknis' }).click();
    await expect(hasil.getByText(/Validasi teknis tersimpan pukul \d{2}\.\d{2}/)).toBeVisible();
    await expect(hasil.getByRole('button', { name: 'Validasi klinis (TTE Sp.PK)' })).toBeDisabled();
    await switchRole(page, 'Dokter (DPJP)');
    await page.goto(`/penunjang/lab?pilih=${LAB_SAMPLE_ID.endang}`);
    await hasil.getByRole('button', { name: 'Validasi klinis (TTE Sp.PK)' }).click();
    await expect(hasil.getByText(/Validasi klinis selesai pukul \d{2}\.\d{2}/)).toBeVisible();
    await expect(hasil.getByRole('button', { name: 'Tervalidasi' })).toBeDisabled();
    // Mockup: "Minta ulang sampel" tetap tampil, nonaktif dengan alasan setelah hasil dirilis.
    await expect(hasil.getByRole('button', { name: 'Minta ulang sampel' })).toBeDisabled();
    await expect(hasil.getByText(/^Minta ulang sampel: Hasil sudah dirilis/)).toBeVisible();
  });

  test('skenario IGD: hasil kritis Tn. Hartono dilaporkan dengan read-back dari layar Lab', async ({
    page,
  }) => {
    const analis = await createAccount({ roles: ['analis_lab'] });
    await loginAs(page, analis, '/simulasi');
    await jumpTo(page, 'IGD → rawat inap', 'Lab & nilai kritis');
    await page.goto('/penunjang/lab');
    const worklist = page.getByRole('region', { name: 'Worklist' });
    await worklist.getByRole('button', { name: /Tn\. Hartono Wibisono/ }).click();
    await page
      .getByRole('region', { name: 'Hasil pemeriksaan' })
      .getByRole('button', { name: 'Buka hasil' })
      .click();
    const kritis = page.getByRole('region', { name: /Nilai kritis terbuka · Tn\. Hartono Wibisono/ });
    await expect(kritis).toContainText('Kalium 6,8 mmol/L');
    await kritis.getByRole('button', { name: 'Catat pelaporan' }).click();
    await kritis
      .getByRole('textbox', { name: 'Nama penerima laporan (DPJP / dokter jaga)' })
      .fill('dr. Rina Kusuma (dokter jaga IGD)');
    await kritis.getByRole('checkbox', { name: /Read-back/ }).check();
    await kritis.getByRole('button', { name: 'Simpan pelaporan' }).click();
    const dilaporkan = page.getByRole('region', { name: /Nilai kritis dilaporkan · Tn\. Hartono Wibisono/ });
    await expect(dilaporkan).toContainText(/waktu lapor 05:\d{2} \(target ≤ 30 menit/);
  });

  test('tablet 768 px tanpa scroll horizontal', async ({ page }) => {
    const analis = await createAccount({ roles: ['analis_lab'] });
    await page.setViewportSize({ width: 768, height: 1024 });
    await loginAs(page, analis, `/penunjang/lab?pilih=${LAB_SAMPLE_ID.endang}`);
    await expect(page.getByRole('region', { name: 'Hasil pemeriksaan' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});

async function checkAll(region: Locator) {
  const boxes = region.getByRole('list').first().getByRole('checkbox');
  const n = await boxes.count();
  for (let i = 0; i < n; i++) await boxes.nth(i).check();
}

test.describe('penunjang · farmasi', () => {
  test('tab antrean; CDS menahan telaah; obat high alert wajib cek ganda apoteker kedua; stok depo berkurang', async ({
    page,
  }) => {
    const apoteker = await sharedAccount('apoteker', 'Apoteker Penyiap Fiktif');
    const second = await sharedAccount('apoteker', 'Apoteker Pemeriksa Fiktif');
    await resetShared(page, apoteker);
    await switchRole(page, 'Apoteker');
    await page.goto('/penunjang/farmasi');
    await expect(
      page.getByRole('heading', { name: 'Farmasi · verifikasi dan penyiapan', level: 1 }),
    ).toBeVisible();
    await expect(page.getByRole('tab', { name: /^Telaah · \d+$/ })).toHaveAttribute('aria-selected', 'true');
    // Mockup: tab antrean ada di kepala halaman, sejajar judul.
    await expect(
      page
        .locator('header')
        .filter({ has: page.getByRole('heading', { name: 'Farmasi · verifikasi dan penyiapan' }) })
        .getByRole('tablist', { name: 'Antrean' }),
    ).toBeVisible();
    await page
      .getByRole('region', { name: 'Antrean telaah' })
      .getByRole('button', { name: /Tn\. Sutan Batubara/ })
      .click();
    const items = page.getByRole('region', { name: 'Item resep' });
    await expect(items.getByText('KFA 93000387 · Fornas')).toBeVisible();
    const approve = page.getByRole('button', { name: 'Setujui dan siapkan' });
    await expect(approve).toBeDisabled();
    await expect(page.getByText(/Tindak lanjuti 2 peringatan CDS/)).toBeVisible();

    await page.getByRole('button', { name: 'Usulkan ke dokter: ganti pantoprazol' }).click();
    await expect(page.getByRole('button', { name: 'Setujui sebagai dokter' })).toBeDisabled();
    await switchRole(page, 'Dokter (DPJP)');
    await page.goto('/penunjang/farmasi');
    await page
      .getByRole('region', { name: 'Antrean telaah' })
      .getByRole('button', { name: /Tn\. Sutan Batubara/ })
      .click();
    await page.getByRole('button', { name: 'Setujui sebagai dokter' }).click();
    await expect(items.getByText('Pantoprazol 40 mg inj')).toBeVisible();
    await switchRole(page, 'Apoteker');
    await page.goto('/penunjang/farmasi');
    await page
      .getByRole('region', { name: 'Antrean telaah' })
      .getByRole('button', { name: /Tn\. Sutan Batubara/ })
      .click();
    await page.getByRole('button', { name: 'Tetap lanjut dengan alasan klinis' }).click();
    await expect(page.getByRole('button', { name: 'Simpan alasan dan lanjut' })).toBeDisabled();
    await page.getByRole('button', { name: 'Batal', exact: true }).click();
    await page.getByRole('button', { name: 'Dosis sudah sesuai eGFR' }).click();
    await expect(approve).toBeEnabled();
    await approve.click();
    await expect(page.getByRole('status').filter({ hasText: 'masuk antrean penyiapan' })).toBeVisible();

    await page.getByRole('button', { name: 'Buka Penyiapan' }).click();
    await page
      .getByRole('region', { name: 'Antrean penyiapan' })
      .getByRole('button', { name: /Tn\. Sutan Batubara/ })
      .click();
    const kerja = page.getByRole('region', { name: 'Penyiapan obat' });
    await checkAll(kerja);
    const selesai = kerja.getByRole('button', { name: 'Selesai disiapkan' });
    await expect(selesai).toBeDisabled();
    await expect(
      kerja.getByText('Cek ganda obat high alert oleh apoteker kedua belum dilakukan.'),
    ).toBeVisible();
    await kerja.getByRole('checkbox', { name: /dihitung ulang/ }).check();
    await kerja.getByRole('button', { name: 'Konfirmasi cek ganda' }).click();
    await expect(kerja.getByRole('alert')).toContainText('sesi petugas berbeda');
    const otherContext = await page
      .context()
      .browser()!
      .newContext({ baseURL: test.info().project.use.baseURL as string });
    const other = await otherContext.newPage();
    try {
      await loginRole(other, second, 'Apoteker');
      await other.goto('/penunjang/farmasi?tab=siap');
      await other
        .getByRole('region', { name: 'Antrean penyiapan' })
        .getByRole('button', { name: /Tn\. Sutan Batubara/ })
        .click();
      const prep = other.getByRole('region', { name: 'Penyiapan obat' });
      await prep.getByRole('checkbox', { name: /dihitung ulang/ }).check();
      await prep.getByRole('button', { name: 'Konfirmasi cek ganda' }).click();
      await expect(prep).toContainText('Cek ganda high alert oleh Apoteker Pemeriksa Fiktif');
    } finally {
      await otherContext.close();
    }
    await page.reload();
    await expect(kerja).toContainText('Cek ganda high alert oleh Apoteker Pemeriksa Fiktif');
    await expect(selesai).toBeEnabled();
    await selesai.click();
    await expect(page.getByRole('status').filter({ hasText: 'masuk antrean serah terima' })).toBeVisible();

    await page.getByRole('tab', { name: /^Serah terima · \d+$/ }).click();
    await page
      .getByRole('region', { name: 'Antrean serah terima' })
      .getByRole('button', { name: /Tn\. Bonifasius/ })
      .click();
    await expect(items).toContainText('→');
    const serah = page.getByRole('region', { name: 'Serah terima obat' });
    await checkAll(serah);
    await serah.getByRole('radio', { name: 'Pasien sendiri' }).check();
    await serah.getByRole('button', { name: 'Serahkan obat' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Serah terima obat' })).toContainText(
      'tersimpan',
    );
    await page.reload();
    await expect(
      page
        .getByRole('region', { name: 'Antrean serah terima' })
        .getByRole('button', { name: /Tn\. Bonifasius/ }),
    ).toHaveCount(0);
  });

  test('skenario rawat jalan: resep Tn. Suryo ditelaah, disiapkan, dan diserahkan dari layar Farmasi', async ({
    page,
  }) => {
    const apoteker = await createAccount({ roles: ['apoteker'] });
    await loginAs(page, apoteker, '/simulasi');
    await jumpTo(page, null, 'Farmasi');
    await page.goto('/penunjang/farmasi');
    await page
      .getByRole('region', { name: 'Antrean telaah' })
      .getByRole('button', { name: /Tn\. Suryo/ })
      .click();
    await page.getByRole('button', { name: 'Setujui dan siapkan' }).click();
    // Tunggu tugas `telaah` selesai di server, lalu pindah lewat tab (umpan balik kilat bisa hilang saat halaman
    // diperbarui) dan pastikan resep sudah di antrean penyiapan.
    await expect(page.getByRole('status').filter({ hasText: 'masuk antrean penyiapan' })).toBeVisible();
    await page.getByRole('tab', { name: /^Penyiapan · \d+$/ }).click();
    const siapRow = page
      .getByRole('region', { name: 'Antrean penyiapan' })
      .getByRole('button', { name: /Tn\. Suryo/ });
    await expect(siapRow).toBeVisible();
    await siapRow.click();
    const kerja = page.getByRole('region', { name: 'Penyiapan obat' });
    await checkAll(kerja);
    await kerja.getByRole('button', { name: 'Selesai disiapkan' }).click();
    // Tunggu keadaan sesudah tugas `siap` (data server) sebelum mencentang serah terima.
    await expect(page.getByRole('status').filter({ hasText: 'masuk antrean serah terima' })).toBeVisible();
    await page.getByRole('tab', { name: /^Serah terima · \d+$/ }).click();
    const serahRow = page
      .getByRole('region', { name: 'Antrean serah terima' })
      .getByRole('button', { name: /Tn\. Suryo/ });
    await expect(serahRow).toContainText('Siap diserahkan');
    await serahRow.click();
    const serah = page.getByRole('region', { name: 'Serah terima obat' });
    await checkAll(serah);
    await expect(serah.getByText(/Lengkapi \d+ centang lagi/)).toHaveCount(0);
    await expect(serah.getByRole('radio', { name: 'Perawat ruangan' })).toHaveCount(0);
    await serah.getByRole('radio', { name: 'Keluarga' }).check();
    await serah.getByRole('button', { name: 'Serahkan obat' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'diserahkan ke keluarga pasien' })).toBeVisible();
  });

  test('tablet 768 px tanpa scroll horizontal', async ({ page }) => {
    const apoteker = await createAccount({ roles: ['apoteker'] });
    await page.setViewportSize({ width: 768, height: 1024 });
    await loginAs(page, apoteker, '/penunjang/farmasi');
    await expect(page.getByRole('region', { name: 'Item resep' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});

test.describe('penunjang · radiologi', () => {
  test('papan modalitas dan worklist; dosis CT wajib; ekspertise ditandatangani radiolog', async ({
    page,
  }) => {
    const radiografer = await createAccount({ roles: ['radiografer', 'dokter'] });
    await loginRole(page, radiografer, 'Radiografer');
    await page.goto('/penunjang/radiologi');
    await expect(
      page.getByRole('heading', { name: 'Radiologi · pemeriksaan dan ekspertise', level: 1 }),
    ).toBeVisible();
    const board = page.getByRole('region', { name: 'Papan modalitas' });
    await expect(board.getByText('CT scan 64 slice')).toBeVisible();
    await expect(board.getByText('13/18 slot')).toBeVisible();
    const worklist = page.getByRole('region', { name: 'Worklist radiologi' });
    await expect(worklist.getByText('ICD-9-CM 87.03')).toBeVisible();
    await expect(worklist.getByText('kode belum dipetakan').first()).toBeVisible();

    // CT berlangsung: dosis radiasi wajib sebelum dikirim ke ekspertise.
    await worklist.getByRole('button', { name: /Ny\. Maria Ulfa/ }).click();
    const akuisisi = page.getByRole('region', { name: 'Selesai pemeriksaan' });
    const kirim = akuisisi.getByRole('button', { name: 'Selesai, kirim ke ekspertise' });
    await expect(kirim).toBeDisabled();
    await expect(akuisisi.getByText('Isi CTDIvol (mGy) antara 0 dan 200.')).toBeVisible();
    await akuisisi.getByRole('textbox', { name: 'CTDIvol (mGy)' }).fill('14,2');
    await akuisisi.getByRole('textbox', { name: 'DLP (mGy·cm)' }).fill('720');
    await kirim.click();
    await expect(page.getByRole('region', { name: 'Ekspertise' })).toBeVisible();
    await switchRole(page, 'Dokter (DPJP)');
    await page.goto(`/penunjang/radiologi?pilih=${RAD_EXAM_ID.maria}`);

    // Ekspertise: templat, lalu TTE radiolog.
    const ekspertise = page.getByRole('region', { name: 'Ekspertise' });
    const tte = ekspertise.getByRole('button', { name: 'Tandatangani (TTE)' });
    await expect(tte).toBeDisabled();
    await expect(ekspertise.getByText('Temuan wajib diisi (minimal 20 karakter).')).toBeVisible();
    await ekspertise
      .getByRole('textbox', { name: 'Temuan' })
      .fill(
        'Massa di kolon sigmoid mengecil dibanding CT sebelumnya. Tidak tampak lesi hepar baru. Tidak tampak asites.',
      );
    await ekspertise.getByRole('textbox', { name: 'Kesan' }).fill('Respons parsial pasca kemoterapi.');
    await tte.click();
    const laporan = page.getByRole('region', { name: 'Laporan radiologi' });
    await expect(laporan).toContainText('Ditandatangani Pengguna E2E Fiktif');
    await expect(laporan).toContainText('Respons parsial pasca kemoterapi.');
    await expect(page.getByRole('region', { name: 'Order pemeriksaan' })).toContainText('DLP 720 mGy·cm');

    // Pemeriksaan terjadwal: mulai hanya setelah identitas dicek.
    await worklist.getByRole('button', { name: /Tn\. Rizky Ramadhan/ }).click();
    const mulai = page.getByRole('region', { name: 'Mulai pemeriksaan' });
    await expect(mulai.getByRole('button', { name: 'Mulai pemeriksaan' })).toBeDisabled();
    await mulai.getByRole('checkbox', { name: /Identitas dicek dengan 2 penanda/ }).check();
    await mulai.getByRole('button', { name: 'Mulai pemeriksaan' }).click();
    await expect(page.getByRole('region', { name: 'Selesai pemeriksaan' })).toBeVisible();
  });

  test('skenario IGD: foto toraks Tn. Hartono muncul dari order set', async ({ page }) => {
    const radiografer = await createAccount({ roles: ['radiografer'] });
    await loginAs(page, radiografer, '/simulasi');
    await jumpTo(page, 'IGD → rawat inap', 'Lab & nilai kritis');
    await page.goto('/penunjang/radiologi');
    const worklist = page.getByRole('region', { name: 'Worklist radiologi' });
    await expect(worklist.getByRole('button', { name: /Tn\. Hartono Wibisono/ })).toContainText(
      'Foto toraks',
    );
  });

  test('tablet 768 px tanpa scroll horizontal', async ({ page }) => {
    const radiografer = await createAccount({ roles: ['radiografer'] });
    await page.setViewportSize({ width: 768, height: 1024 });
    await loginAs(page, radiografer, `/penunjang/radiologi?pilih=${RAD_EXAM_ID.dewi}`);
    await expect(page.getByRole('region', { name: 'Ekspertise' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});
