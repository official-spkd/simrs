import { expect, type Page, test } from '@playwright/test';
import { type Account, createAccount, loginAs, submitPassword, totpFor, typeCode } from '../support/accounts';
import { CLAIM_ID, INVOICE_ID } from '../../src/lib/demo/fixtures/ids';

/**
 * Keuangan (mode presentasi, ADR-0023; mockup Kasir, Klaim, Akuntansi). Aksi tersimpan di toko demo bersama
 * (ADR-0085): diperiksa bertahan setelah muat ulang dan mengalir antarlayar (pendaftaran → charge capture → kasir →
 * klaim → pembiayaan BTN; kasir → pembayaran digital → akuntansi). Akun uji punya ruang data sendiri.
 */

async function loginWithPosition(page: Page, account: Account, roleName: string) {
  await page.goto('/');
  await expect(page).toHaveURL(/\/masuk/);
  await submitPassword(page, account, account.password);
  await typeCode(page, totpFor(account.totpSecret as string));
  await page.getByRole('button', { name: 'Verifikasi dan lanjut' }).click();
  await expect(page.getByRole('heading', { name: 'Pilih posisi dan unit kerja' })).toBeVisible();
  await page.getByText(roleName, { exact: true }).click();
  await page.getByRole('button', { name: `Masuk sebagai ${roleName}` }).click();
  await expect(page.getByText(new RegExp(`Anda masuk sebagai\\s*${roleName}`))).toBeVisible();
}

async function switchPosition(page: Page, roleName: string) {
  await page.getByRole('link', { name: 'Ganti posisi' }).first().click();
  await expect(page.getByRole('heading', { name: 'Ganti posisi', level: 1 })).toBeVisible();
  await page.getByText(roleName, { exact: true }).click();
  await page.getByRole('button', { name: `Pindah ke ${roleName}` }).click();
  await expect(page.getByText(new RegExp(`Anda masuk sebagai\\s*${roleName}`))).toBeVisible();
}

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe('kasir', () => {
  test('total tagihan = jumlah baris yang tampil; bayar QRIS sampai kuitansi', async ({ page }) => {
    const kasir = await createAccount({ roles: ['kasir'] });
    await loginAs(page, kasir, '/keuangan/kasir');
    await page.goto(`/keuangan/kasir?pilih=${INVOICE_ID.endang}`);
    await expect(page.getByRole('heading', { name: 'Kasir · tagihan pasien', level: 1 })).toBeVisible();
    await expect(page.getByText('Ny. Endang Wijaya').first()).toBeVisible();
    await expect(page.getByText('INV-2610-02217')).toBeVisible();

    const bill = page.getByRole('region', { name: 'Rincian tagihan' });
    await bill.getByRole('button', { name: 'Buka semua kategori' }).click();
    // Tunggu render terbuka (auto-wait) sebelum membaca baris sekaligus.
    await expect(bill.getByRole('button', { name: 'Tutup semua kategori' })).toBeVisible();
    const sum = await bill
      .locator('[data-line-amount]')
      .evaluateAll((els) =>
        els.reduce((s, e) => s + BigInt(e.getAttribute('data-line-amount') ?? '0'), 0n).toString(),
      );
    const total = await bill.locator('[data-total-amount]').getAttribute('data-total-amount');
    expect(sum).toBe(total);
    await expect(bill.locator('[data-total-amount]')).toHaveText('Rp 17.217.500');
    const split = page.getByRole('region', { name: 'Pembagian penjamin' });
    await expect(split).toContainText('Rp 1.250.400');
    // Mockup Kasir: tarif INA-CBG kelas tujuan tampil; selisih = kelas 1 − kelas 2.
    await expect(split.getByText('Tarif INA-CBG J-4-15-II (kelas 1)')).toBeVisible();
    await expect(split).toContainText('Rp 7.863.200');

    const pay = page.getByRole('region', { name: 'Pembayaran' });
    const finish = pay.getByRole('button', { name: 'Selesaikan dan cetak kuitansi' });
    await expect(finish).toBeDisabled();
    await expect(pay.getByText('Menunggu pembayaran QRIS diterima.')).toBeVisible();
    await pay.getByRole('button', { name: 'Simulasikan pembayaran diterima' }).click();
    await expect(finish).toBeEnabled();
    await finish.click();
    await expect(pay.getByText(/kuitansi KW-2610-02217 · \d{2}\.\d{2}/)).toBeVisible();
    await expect(page.getByText(/tidak disimpan/)).toHaveCount(0);
    await expect(
      pay.getByText(/jurnal bank terbentuk otomatis\. Klaim BPJS hak kelas 2 diteruskan ke casemix/),
    ).toBeVisible();
    const after = pay.getByRole('navigation', { name: 'Langkah setelah lunas' });
    await expect(after.getByRole('link', { name: 'Lanjut ke klaim BPJS' })).toHaveAttribute(
      'href',
      '/keuangan/klaim',
    );
    await expect(after.getByRole('link', { name: 'Lihat jurnal' })).toHaveAttribute(
      'href',
      '/keuangan/akuntansi',
    );
    await expect(after.getByRole('link', { name: 'Pembayaran digital' })).toHaveAttribute(
      'href',
      '/keuangan/pembayaran',
    );
    await noHorizontalOverflow(page);
    // Bertahan: muat ulang → tetap lunas dengan kuitansi yang sama.
    await page.reload();
    await expect(pay.getByText(/kuitansi KW-2610-02217 · \d{2}\.\d{2}/)).toBeVisible();
  });

  test('item manual diblokir tanpa alasan tertulis', async ({ page }) => {
    const kasir = await createAccount({ roles: ['kasir'] });
    await loginAs(page, kasir, '/keuangan/kasir');
    await page.goto(`/keuangan/kasir?pilih=${INVOICE_ID.ayu}`);
    const bill = page.getByRole('region', { name: 'Rincian tagihan' });
    await expect(bill.locator('[data-total-amount]')).toHaveText('Rp 463.500');

    await page.getByRole('button', { name: 'Tambah item manual' }).click();
    const form = page.getByRole('form', { name: 'Tambah item manual' });
    await expect(form.getByLabel('Nama item')).toBeFocused();
    await form.getByLabel('Kuantitas').fill('2.5');
    await expect(form.getByText('Isi bilangan bulat 1–99 tanpa desimal.')).toBeVisible();
    await form.getByLabel('Kuantitas').fill('1');
    await expect(form.getByText('Isi bilangan bulat 1–99 tanpa desimal.')).toHaveCount(0);
    await form.getByLabel('Nama item').fill('Nebulisasi tambahan');
    await form.getByLabel('Harga satuan (Rp)').fill('35000');
    const submit = form.getByRole('button', { name: 'Ajukan item manual' });
    await expect(submit).toBeDisabled();
    await expect(form.getByText(/Belum bisa diajukan: tulis alasan/)).toBeVisible();

    await form.getByLabel(/Alasan item manual/).fill('Tindakan malam hari belum tercatat di eMAR');
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(bill.locator('[data-total-amount]')).toHaveText('Rp 498.500');
    await bill.getByRole('button', { name: 'Buka semua kategori' }).click();
    await expect(bill.getByText('Nebulisasi tambahan')).toBeVisible();
    await expect(bill.getByText('Manual', { exact: true })).toBeVisible();
    await noHorizontalOverflow(page);
    // Bertahan + mengalir: item manual tetap setelah muat ulang dan muncul sebagai event di Charge capture.
    await page.reload();
    await expect(bill.locator('[data-total-amount]')).toHaveText('Rp 498.500');
    await page.goto('/keuangan/charge-capture');
    await expect(
      page.getByRole('listitem', { name: /Item manual kasir/ }).filter({ hasText: 'Nebulisasi tambahan' }),
    ).toBeVisible();
  });

  test('posisi lain melihat ajakan ganti posisi', async ({ page }) => {
    const kasir = await createAccount({ roles: ['kasir'] });
    await loginAs(page, kasir, '/keuangan/kasir');
    await page.goto('/keuangan/klaim');
    await expect(page.getByText('Layar ini untuk posisi lain')).toBeVisible();
  });
});

test.describe('klaim', () => {
  test('koder membuka berkas: tabel ICD-10/ICD-9-CM, grouper, saran J13 lalu kirim', async ({ page }) => {
    const koder = await createAccount({ roles: ['koder'] });
    await loginAs(page, koder, '/keuangan/klaim');
    await page.goto(`/keuangan/klaim?status=draft&pilih=${CLAIM_ID.endang}`);
    await expect(
      page.getByRole('heading', { name: 'Klaim JKN · koding dan grouping', level: 1 }),
    ).toBeVisible();
    await expect(page.getByRole('region', { name: 'Indikator klaim' }).getByText('1.284')).toBeVisible();

    const dx = page.getByRole('table', { name: 'Diagnosis ICD-10' });
    const px = page.getByRole('table', { name: 'Prosedur ICD-9-CM' });
    await expect(dx.getByText('J18.9', { exact: true })).toBeVisible();
    await expect(px.getByText('89.65', { exact: true })).toBeVisible();
    const grouper = page.getByRole('region', { name: 'Hasil grouper' });
    await expect(grouper.getByText('J-4-15-II', { exact: true }).first()).toBeVisible();

    const send = page.getByRole('button', { name: 'Final dan kirim E-Klaim' });
    await expect(send).toBeDisabled();
    await expect(page.getByText(/Belum bisa dikirim: lengkapi 1 berkas/)).toBeVisible();

    await page.getByRole('button', { name: 'Terima J13' }).click();
    await expect(dx.getByText('J13', { exact: true })).toBeVisible();
    await page.getByLabel(/Bukti klinis N17\.9 di CPPT/).click();
    await expect(page.getByLabel(/Bukti klinis N17\.9 di CPPT/)).toBeChecked();
    await expect(grouper.getByText('J-4-15-III', { exact: true })).toBeVisible();
    await expect(grouper.getByText('Rp 9.104.300')).toBeVisible();

    await expect(send).toBeEnabled();
    await send.click();
    await expect(page.getByText(/Terkirim ke E-Klaim \d{2}\.\d{2}/)).toBeVisible();
    await noHorizontalOverflow(page);
    // Bertahan: muat ulang → klaim tetap terkirim (status berkas di verifikator).
    await page.reload();
    await expect(page.getByText(/Terkirim ke E-Klaim \d{2}\.\d{2}/)).toBeVisible();
  });
});

test.describe('klaim · keadaan kerja koder (mockup Klaim)', () => {
  test('query, saran, dan kirim bertahan saat pindah klaim; chip daftar dan status berkas ikut berubah', async ({
    page,
  }) => {
    const koder = await createAccount({ roles: ['koder'] });
    await loginAs(page, koder, '/keuangan/klaim');
    await page.goto(`/keuangan/klaim?status=draft&pilih=${CLAIM_ID.endang}`);
    const list = page.getByRole('region', { name: 'Daftar klaim' });
    const rows = list.getByRole('listitem');
    const endang = rows.filter({ hasText: 'Ny. Endang Wijaya' });
    const status = page.locator('[data-claim-status]');

    await page.getByRole('button', { name: 'Kirim query ke DPJP' }).first().click();
    await expect(status).toHaveText('Menunggu jawaban DPJP');
    await expect(endang.getByText('Menunggu DPJP')).toBeVisible();

    // Pindah ke berkas lain lalu kembali: query tetap tercatat.
    await rows.filter({ hasNotText: 'Ny. Endang Wijaya' }).first().getByRole('link').click();
    await expect(page).not.toHaveURL(new RegExp(CLAIM_ID.endang));
    await endang.getByRole('link').click();
    await expect(page).toHaveURL(new RegExp(CLAIM_ID.endang));
    await expect(status).toHaveText('Menunggu jawaban DPJP');

    const send = page.getByRole('button', { name: 'Final dan kirim E-Klaim' });
    await expect(send).toBeDisabled();
    await expect(send).toHaveAttribute('aria-describedby', /.+/);
    await page.getByRole('button', { name: 'DPJP setuju · terapkan J13' }).click();
    await expect(status).toHaveText('Siap grouping · J13');
    await expect(endang.getByText('Saran diterima')).toBeVisible();
    await page.getByLabel(/Bukti klinis N17\.9 di CPPT/).click();
    await expect(page.getByLabel(/Bukti klinis N17\.9 di CPPT/)).toBeChecked();
    await expect(status).toHaveText('Siap final · J-4-15-III');
    await send.click();
    await expect(status).toHaveText('Terkirim ke E-Klaim');
    await expect(endang.getByText('Terkirim', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Lihat jurnal piutang di Akuntansi' })).toHaveAttribute(
      'href',
      '/keuangan/akuntansi',
    );
  });
});

test.describe('akuntansi', () => {
  test('jurnal seimbang, dialog tutup periode menahan sampai syarat terpenuhi', async ({ page }) => {
    const akuntan = await createAccount({ roles: ['akuntan'] });
    await loginAs(page, akuntan, '/keuangan/akuntansi');
    await page.goto('/keuangan/akuntansi');
    await expect(
      page.getByRole('heading', { name: 'Akuntansi · jurnal dan piutang', level: 1 }),
    ).toBeVisible();

    const pairs = await page
      .locator('tbody[data-journal]')
      .evaluateAll((bodies) =>
        bodies.map((b) => [
          b.querySelector('[data-total-debit]')?.getAttribute('data-total-debit') ?? 'x',
          b.querySelector('[data-total-credit]')?.getAttribute('data-total-credit') ?? 'y',
        ]),
      );
    expect(pairs.length).toBeGreaterThanOrEqual(6);
    for (const [d, c] of pairs) expect(d).toBe(c);

    const journals = page.getByRole('region', { name: 'Jurnal otomatis' });
    await journals.getByRole('button', { name: /Logistik/ }).click();
    await expect(journals.locator('tbody[data-journal]')).toHaveCount(2);
    await journals.getByRole('button', { name: 'Semua' }).click();

    await page.getByRole('button', { name: 'Tutup periode Oktober' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Tutup periode Oktober 2026?' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Ya, tutup dan kunci periode' })).toBeDisabled();
    await expect(dialog.getByText(/Belum bisa ditutup: petakan akun JU-26100417/)).toBeVisible();
    await expect(dialog.getByText(/BTN penampungan klaim BPJS ••••9021 masih 2 selisih/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Batal' }).click();
    await expect(dialog).toBeHidden();

    // Pemetaan dua langkah (mockup): Petakan akun → pilih akun, atau Batal.
    await expect(page.getByLabel('Akun lawan (kredit)')).toHaveCount(0);
    const mapBtn = page.getByRole('button', { name: 'Petakan akun' });
    await expect(mapBtn).toHaveAttribute('aria-expanded', 'false');
    await mapBtn.click();
    await page.getByRole('button', { name: 'Batal' }).click();
    await expect(page.getByLabel('Akun lawan (kredit)')).toHaveCount(0);
    await mapBtn.click();
    await page.getByLabel('Akun lawan (kredit)').selectOption('1-1390');
    await expect(page.getByText(/siap diposting setelah disetujui penyetuju kedua/)).toBeVisible();
    const recon = page.getByRole('region', { name: 'Rekonsiliasi bank' });
    await expect(recon.getByRole('link', { name: 'Rekonsiliasi 3 arah TPDI × BTN' })).toHaveAttribute(
      'href',
      '/keuangan/pembayaran',
    );
    await page.getByRole('button', { name: 'Padankan 2 transfer ke batch klaim' }).click();
    await expect(page.getByRole('region', { name: 'Rekonsiliasi bank' }).getByText('2 selisih')).toHaveCount(
      0,
    );

    // Pembuat ≠ penyetuju (id pengguna sesi): pembuat pemetaan tidak bisa menyetujui sendiri.
    const approve = page.getByRole('button', { name: 'Setujui dan posting' });
    await expect(approve).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByText(/Pemisahan tugas: Anda pembuat pemetaan/)).toBeVisible();
    // K-2 (usulan, menunggu konfirmasi pemilik produk): tutup periode diblokir selama jurnal menunggu penyetuju kedua.
    await page.getByRole('button', { name: 'Tutup periode Oktober' }).click();
    await expect(dialog.getByRole('button', { name: 'Ya, tutup dan kunci periode' })).toBeDisabled();
    await expect(dialog.getByText(/JU-26100417 masih menunggu penyetuju kedua/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Batal' }).click();
    // Bertahan: muat ulang → pemetaan dan pemadanan masih tercatat atas nama pengguna sesi.
    await page.reload();
    await expect(page.getByText(/dipetakan ke .* oleh Pengguna E2E Fiktif/)).toBeVisible();
    await expect(page.getByRole('region', { name: 'Rekonsiliasi bank' }).getByText('2 selisih')).toHaveCount(
      0,
    );
    await noHorizontalOverflow(page);
  });
});

test.describe('aliran keuangan antarlayar (toko demo)', () => {
  test('pendaftaran → charge capture → kasir → klaim → pembiayaan BTN; jurnal di Akuntansi', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const akun = await createAccount({
      roles: ['petugas_pendaftaran', 'kasir', 'koder', 'akuntan'],
      displayName: 'Staf Alur Keuangan Fiktif',
    });
    await loginWithPosition(page, akun, 'Petugas pendaftaran');

    // Pendaftaran pasien BPJS (SEP + kunjungan) → kejadian `kunjungan.terdaftar` membawa charge ADM-RJ.
    await page.goto('/pendaftaran');
    await page.getByLabel('Cari pasien (NIK, No. RM, No. BPJS, nama + tgl lahir)').fill('00-12-45-78');
    await page.getByRole('button', { name: 'Cari pasien', exact: true }).click();
    await page.getByRole('button', { name: 'Cek kepesertaan', exact: true }).click();
    await page.getByRole('button', { name: /Surat kontrol · Poli Penyakit Dalam/ }).click();
    await page.getByRole('button', { name: 'Terbitkan SEP dan daftarkan', exact: true }).click();
    await expect(page.getByText(/SEP 0301R0011026V000812 terbit pukul \d{2}\.\d{2}/)).toBeVisible();
    await page.getByRole('button', { name: 'Pakai jadwal ini dan bentuk antrean' }).click();
    await page.getByLabel(/Persetujuan umum \(general consent\)/).check();
    await page.getByRole('button', { name: 'Kirim antrean dan selesaikan' }).click();
    await expect(page.getByText(/Terdaftar pukul \d{2}\.\d{2} · antrean PD-028/)).toBeVisible();

    // Charge capture: event pendaftaran tertagih.
    await switchPosition(page, 'Kasir');
    await page.goto('/keuangan/charge-capture');
    await expect(
      page.getByRole('listitem', { name: /Siti Rahmawati Kunjungan Poli Penyakit Dalam terdaftar/ }),
    ).toContainText('Rp 30.000');

    // Kasir: tagihan rawat jalan baru INV-2610-02401 (ADM-RJ), BPJS → final → tutup (pasien Rp 0).
    await page.goto('/keuangan/kasir?pilih=inv-rj-kj-1');
    await expect(page.getByText('INV-2610-02401')).toBeVisible();
    const bill = page.getByRole('region', { name: 'Rincian tagihan' });
    await expect(bill.locator('[data-total-amount]')).toHaveText('Rp 30.000');
    await page.getByRole('button', { name: 'Finalkan tagihan' }).click();
    await page.getByRole('button', { name: 'Tutup kunjungan (pasien bayar Rp 0)' }).click();
    const pay = page.getByRole('region', { name: 'Pembayaran' });
    await expect(pay.getByText('Lunas', { exact: true })).toBeVisible();
    await page.reload();
    await expect(pay.getByText('Lunas', { exact: true })).toBeVisible();

    // Klaim: berkas BPJS dari Kasir (I10 dari SEP, grouper Q-5-44-0) → kirim → verifikasi (mock) → layak bayar.
    await switchPosition(page, 'Koder klinis');
    await page.goto('/keuangan/klaim?pilih=kl-inv-rj-kj-1');
    await expect(
      page.getByRole('table', { name: 'Diagnosis ICD-10' }).getByText('I10', { exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Final dan kirim E-Klaim' }).click();
    await expect(page.getByText(/Terkirim ke E-Klaim \d{2}\.\d{2}/)).toBeVisible();
    await page
      .getByRole('button', { name: 'Catat hasil verifikasi BPJS: layak bayar (mock E-Klaim)' })
      .click();
    await expect(page.locator('[data-claim-status]')).toContainText('Layak bayar');

    // Pembiayaan BTN: klaim layak bayar masuk pool; Akuntansi: jurnal pengakuan pendapatan dari Kasir.
    await switchPosition(page, 'Akuntan');
    await page.goto('/keuangan/pembiayaan');
    await expect(page.getByRole('region', { name: 'Pool klaim BPJS' })).toContainText('RJ · Siti Rahmawati');
    await page.goto('/keuangan/akuntansi');
    const jurnal = page.locator('tbody[data-journal]').filter({ hasText: 'Kasir · INV-2610-02401' });
    await expect(jurnal.first()).toContainText('Piutang BPJS — RJ');
  });

  test('kasir QRIS → pembayaran digital (rekonsiliasi 3 arah) → jurnal Akuntansi terposting', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const akun = await createAccount({ roles: ['kasir', 'akuntan'], displayName: 'Kasir Alur Fiktif' });
    await loginWithPosition(page, akun, 'Kasir');
    await page.goto(`/keuangan/kasir?pilih=${INVOICE_ID.endang}`);
    const pay = page.getByRole('region', { name: 'Pembayaran' });
    await pay.getByRole('button', { name: 'Simulasikan pembayaran diterima' }).click();
    await pay.getByRole('button', { name: 'Selesaikan dan cetak kuitansi' }).click();
    await expect(pay.getByText(/kuitansi KW-2610-02217/)).toBeVisible();

    // Pembayaran digital: tagihan TPDI Endang lunas dari Kasir; rekonsiliasi memadankan tiga sumber.
    await page.goto('/keuangan/pembayaran');
    const daftar = page.getByRole('region', { name: 'Daftar transaksi' });
    await daftar.getByRole('button', { name: /Ny\. Endang Wijaya/ }).click();
    const detail = page.getByRole('complementary', { name: 'Detail transaksi' });
    await expect(detail.getByText('✓ HMAC valid').first()).toBeVisible();
    await page.getByRole('tab', { name: /^Rekonsiliasi/ }).click();
    await page.getByRole('button', { name: 'Jalankan rekonsiliasi' }).click();
    await expect(page.getByText(/1 transaksi cocok 3 arah, jurnal terposting/)).toBeVisible();

    await switchPosition(page, 'Akuntan');
    await page.goto('/keuangan/akuntansi');
    const jurnal = page
      .locator('tbody[data-journal]')
      .filter({ hasText: 'Pelunasan pasien INV-2610-02217 · QRIS via TPDI' });
    await expect(jurnal.first()).toContainText('Terposting');
    await expect(page.getByRole('region', { name: 'Jurnal otomatis' })).not.toContainText('tidak disimpan');
  });
});
