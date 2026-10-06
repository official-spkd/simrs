import { expect, type Locator, type Page, test } from '@playwright/test';
import { createAccount, loginAs } from '../support/accounts';

/**
 * Keuangan lanjutan (mode presentasi, ADR-0023; tanpa mockup): tarif, charge capture, piutang, workbench koder,
 * jasa pelayanan, kas & bank, hutang usaha, costing, dan celah fase 6 di Pembayaran digital.
 */

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

/** Setiap jurnal berpasangan yang tampil seimbang (data-total-debit = data-total-credit). */
async function journalsBalanced(scope: Locator | Page, min = 1) {
  const pairs = await scope
    .locator('figure:has([data-total-debit])')
    .evaluateAll((figs) =>
      figs.map((f) => [
        f.querySelector('[data-total-debit]')?.getAttribute('data-total-debit') ?? 'x',
        f.querySelector('[data-total-credit]')?.getAttribute('data-total-credit') ?? 'y',
      ]),
    );
  expect(pairs.length).toBeGreaterThanOrEqual(min);
  for (const [d, c] of pairs) expect(d).toBe(c);
}

test.describe('tarif dan paket (U01)', () => {
  test('akuntan mengajukan usulan; retroaktif ditolak; tidak bisa menyetujui sendiri', async ({ page }) => {
    const akuntan = await createAccount({ roles: ['akuntan'] });
    await loginAs(page, akuntan, '/keuangan/tarif');
    await page.goto('/keuangan/tarif');
    await expect(
      page.getByRole('heading', { name: 'Tarif & paket · master tarif berversi', level: 1 }),
    ).toBeVisible();

    const list = page.getByRole('region', { name: 'Daftar tarif' });
    await list.getByLabel('Cari item tarif').fill('kateter');
    await list.getByRole('button', { name: /Pemasangan kateter urin/ }).click();
    const detail = page.getByRole('region', { name: 'Rincian tarif' });
    await expect(detail.getByRole('heading', { name: 'Pemasangan kateter urin' })).toBeVisible();
    await detail.getByRole('button', { name: 'Buat usulan perubahan' }).click();

    const form = page.getByRole('form', { name: 'Usulan perubahan tarif' });
    const submit = form.getByRole('button', { name: 'Ajukan usulan' });
    await form.getByLabel('Kelas 2 (Rp)').fill('80.000');
    await form.getByLabel('Berlaku mulai').fill('2026-10-05');
    await form.getByLabel('Alasan perubahan (wajib)').fill('Harga kateter silikon naik dari pemasok');
    await expect(submit).toBeDisabled();
    await expect(form.getByText(/tidak retroaktif/).last()).toBeVisible();
    await form.getByLabel('Berlaku mulai').fill('2026-11-01');
    await form.getByLabel('Kelas 1 (Rp)').fill('85.000');
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(
      page.getByText(/Usulan UT-2610-008 diajukan · \w{3}, 5 Okt 2026 · \d{2}\.\d{2}/),
    ).toBeVisible();

    await page.getByRole('tab', { name: /Usulan perubahan/ }).click();
    const usulan = page.getByRole('listitem', { name: /UT-2610-008/ });
    await expect(usulan.getByRole('button', { name: 'Setujui usulan' })).toBeDisabled();
    await expect(usulan.getByText(/posisi manajemen/)).toBeVisible();
    await noHorizontalOverflow(page);
  });

  test('manajemen menyetujui usulan → versi baru terjadwal; paket lebih murah dari item', async ({
    page,
  }) => {
    const direktur = await createAccount({ roles: ['manajemen'] });
    await loginAs(page, direktur, '/keuangan/tarif');
    await page.goto('/keuangan/tarif');
    await page.getByRole('tab', { name: /Usulan perubahan/ }).click();
    const usg = page.getByRole('listitem', { name: /UT-2610-007/ });
    await usg.getByRole('button', { name: 'Setujui usulan' }).click();
    await expect(
      page.getByText(/UT-2610-007 disetujui · \d{2}\.\d{2} · USG abdomen versi baru terjadwal/),
    ).toBeVisible();
    await expect(usg.getByText(/✓ Disetujui/)).toBeVisible();

    const neb = page.getByRole('listitem', { name: /UT-2610-006/ });
    await neb.getByRole('button', { name: 'Tolak…' }).click();
    const reject = neb.getByRole('button', { name: 'Tolak usulan' });
    await expect(reject).toBeDisabled();
    await neb.getByLabel(/Alasan penolakan/).fill('Tunggu hasil costing nebulizer bulan depan');
    await reject.click();
    await expect(neb.getByText(/✗ Ditolak/)).toBeVisible();

    await page.getByRole('tab', { name: 'Paket' }).click();
    const isi = page.getByRole('region', { name: 'Isi paket' });
    const itemized = BigInt((await isi.locator('[data-itemized]').getAttribute('data-itemized')) ?? '0');
    const price = BigInt(
      (await isi.locator('[data-package-price]').getAttribute('data-package-price')) ?? '0',
    );
    expect(price).toBeLessThan(itemized);
    await isi.getByRole('radio', { name: 'VIP' }).click();
    await expect(isi.locator('[data-package-price]')).toHaveText('Rp 18.200.000');
    await noHorizontalOverflow(page);
  });
});

test.describe('charge capture (U02)', () => {
  test('coba ulang setelah tarif disetujui, reprice penjamin, batal manual beralasan', async ({ page }) => {
    const kasir = await createAccount({ roles: ['kasir'] });
    await loginAs(page, kasir, '/keuangan/charge-capture');
    await page.goto('/keuangan/charge-capture');
    await expect(
      page.getByRole('heading', { name: /Charge capture · event klinis/, level: 1 }),
    ).toBeVisible();
    await expect(page.getByText(/17 event = 10 tertagih \+ 4 tertahan \+ 3 pembalik/)).toBeVisible();

    const feed = page.getByRole('region', { name: 'Aliran event klinis' });
    await feed
      .getByRole('group', { name: 'Filter status' })
      .getByRole('button', { name: 'Tertahan' })
      .click();
    const sutan = feed.getByRole('listitem', { name: /Tn\. Sutan Batubara Visite dokter subspesialis/ });
    await sutan.getByRole('button', { name: 'Coba ulang capture' }).click();
    await expect(
      page.getByText(
        /Visite dokter subspesialis VIP Rp 400\.000 masuk tagihan Tn\. Sutan Batubara · \d{2}\.\d{2}/,
      ),
    ).toBeVisible();

    const pct = feed.getByRole('listitem', { name: /prokalsitonin/ });
    await expect(pct.getByRole('button', { name: 'Coba ulang capture' })).toBeDisabled();
    await expect(pct.getByText('Tarif belum disetujui; minta tarif ke pengelola tarif dulu.')).toBeVisible();

    const fr = feed.getByRole('listitem', { name: /Fransiska/ });
    await fr.getByRole('button', { name: 'Reprice baris terbuka' }).click();
    await expect(page.getByText(/Rp 105\.000 masuk tagihan Ny\. Fransiska/)).toBeVisible();
    await expect(page.getByText(/17 event = 12 tertagih \+ 2 tertahan/)).toBeVisible();

    await feed.getByRole('group', { name: 'Filter status' }).getByRole('button', { name: 'Manual' }).click();
    const manual = feed.getByRole('listitem', { name: /Item manual kasir/ });
    await manual.getByRole('button', { name: 'Batalkan baris manual…' }).click();
    const batal = manual.getByRole('button', { name: 'Batalkan baris' });
    await expect(batal).toBeDisabled();
    await manual.getByLabel(/Alasan pembatalan/).fill('Kursi roda milik keluarga, bukan sewa RS');
    await batal.click();
    await expect(
      page.getByText(/Baris manual Sewa kursi roda dibatalkan dengan baris pembalik/),
    ).toBeVisible();
    await expect(feed.locator('[data-line-amount="-25000"]')).toBeVisible();
    await noHorizontalOverflow(page);
  });
});

test.describe('penjaminan dan piutang (U04)', () => {
  test('batch penagihan → kirim → pelunasan bereferensi dengan jurnal seimbang', async ({ page }) => {
    const akuntan = await createAccount({ roles: ['akuntan'] });
    await loginAs(page, akuntan, '/keuangan/piutang');
    await page.goto('/keuangan/piutang');
    await expect(page.getByRole('heading', { name: /Penjaminan & piutang · tagih/, level: 1 })).toBeVisible();

    const list = page.getByRole('region', { name: 'Daftar piutang' });
    const make = list.getByRole('button', { name: 'Buat batch penagihan' });
    await expect(make).toBeDisabled();
    await list.getByLabel(/INV-2610-02190/).check();
    await list.getByLabel(/INV-2610-02244/).check();
    await expect(list.getByText('Satu batch hanya untuk satu penjamin.')).toBeVisible();
    await list.getByLabel(/INV-2610-02244/).uncheck();
    await list.getByLabel(/INV-2610-02205/).check();
    await make.click();
    await expect(
      page.getByText(/Batch TG-2610-005 dibuat untuk Asuransi Mitra A \(2 invoice\)/),
    ).toBeVisible();

    const batch = page.getByRole('article', { name: 'Batch TG-2610-005' });
    await batch.getByRole('button', { name: 'Kirim tagihan ke penjamin' }).click();
    await batch.getByRole('button', { name: 'Catat pelunasan…' }).click();
    const form = batch.getByRole('form', { name: 'Pelunasan TG-2610-005' });
    await form.getByLabel('Nominal diterima (Rp)').fill('9.000.000');
    await expect(form.getByText(/melebihi sisa/)).toBeVisible();
    await form.getByLabel('Nominal diterima (Rp)').fill('8.630.000');
    await form.getByLabel('Referensi mutasi bank').fill('BTN-H2H-2610-90311');
    await journalsBalanced(form);
    await form.getByRole('button', { name: 'Posting pelunasan' }).click();
    await expect(batch.getByText('Lunas', { exact: true })).toBeVisible();
    await expect(
      page.getByText(/Pelunasan TG-2610-005 Rp 8\.630\.000 diposting · \d{2}\.\d{2} · Dr 1-1120/),
    ).toBeVisible();

    const old = page.getByRole('article', { name: 'Batch TG-2609-031' });
    await expect(old.getByText(/Terkunci: periode September 2026 ditutup/)).toBeVisible();

    await page.getByRole('tab', { name: 'Pembagian penjamin' }).click();
    const split = page.getByRole('region', { name: 'Pembagian penjamin' });
    await expect(split.getByText('Rp 1.250.400')).toBeVisible();
    await expect(split.getByText('✓ Total = penjamin + pasien + ditanggung RS')).toBeVisible();
    await journalsBalanced(split);
    await noHorizontalOverflow(page);
  });

  test('penyesuaian: akuntan mengajukan, manajemen menyetujui dan jurnal terposting', async ({
    page,
    browser,
  }) => {
    const akuntan = await createAccount({ roles: ['akuntan'] });
    await loginAs(page, akuntan, '/keuangan/piutang');
    await page.goto('/keuangan/piutang');
    await page.getByRole('tab', { name: /Penyesuaian/ }).click();
    const pending = page.getByRole('listitem', { name: 'AJ-2610-003' });
    await expect(pending.getByRole('button', { name: 'Setujui dan posting' })).toBeDisabled();
    await expect(pending.getByText(/posisi manajemen/)).toBeVisible();
    const form = page.getByRole('form', { name: 'Ajukan penyesuaian piutang' });
    await form.getByLabel('Piutang', { exact: true }).selectOption('pi-07');
    await form.getByLabel('Nominal (Rp)').fill('93.750');
    const submit = form.getByRole('button', { name: 'Ajukan penyesuaian' });
    await expect(submit).toBeDisabled();
    await form.getByLabel(/Alasan/).fill('Diskon kontrak 5% sesuai addendum PKS 2026');
    await submit.click();
    await expect(page.getByText(/Penyesuaian AJ-2610-004 diajukan/)).toBeVisible();

    const direktur = await createAccount({ roles: ['manajemen'] });
    const ctx = await browser.newContext({
      baseURL: test.info().project.use.baseURL,
      viewport: test.info().project.use.viewport,
      locale: 'id-ID',
      timezoneId: 'Asia/Jakarta',
    });
    const mgr = await ctx.newPage();
    await loginAs(mgr, direktur, '/keuangan/piutang');
    await mgr.goto('/keuangan/piutang');
    await mgr.getByRole('tab', { name: /Penyesuaian/ }).click();
    const aj = mgr.getByRole('listitem', { name: 'AJ-2610-003' });
    await aj.getByRole('button', { name: 'Setujui dan posting' }).click();
    await expect(aj.getByText(/✓ Disetujui/)).toBeVisible();
    await expect(
      mgr.getByText(/AJ-2610-003 disetujui dan diposting · \d{2}\.\d{2} · Dr 6-3100 Rp 3\.250\.000/),
    ).toBeVisible();
    await journalsBalanced(aj);
    await ctx.close();
  });
});

test.describe('workbench koder (U06)', () => {
  test('saran diterima, bukti ditautkan, query DPJP dijawab, versi baru beralasan', async ({ page }) => {
    const koder = await createAccount({ roles: ['koder'] });
    await loginAs(page, koder, '/keuangan/koding');
    await page.goto('/keuangan/koding');
    await expect(page.getByRole('heading', { name: /Workbench koder · validasi/, level: 1 })).toBeVisible();

    const detail = page.getByRole('region', { name: 'Berkas koding' });
    const go = detail.getByRole('button', { name: 'Validasi dan teruskan ke grouping' });
    await expect(go).toBeDisabled();
    await expect(detail.getByText(/putuskan saran kode J18\.9/)).toBeVisible();
    await detail.getByRole('button', { name: 'Terima J13' }).click();
    const n17 = detail.getByRole('listitem', { name: 'Kode N17.9' });
    await n17.getByLabel('Bukti dari RME untuk N17.9').selectOption({ index: 1 });
    await n17.getByRole('button', { name: 'Tautkan bukti' }).click();
    await expect(n17.getByText(/✓ Bukti: Kreatinin serial/)).toBeVisible();
    await go.click();
    await expect(page.getByText(/Koding Tn\. Yusuf Hidayat tervalidasi · \d{2}\.\d{2}/)).toBeVisible();

    const nav = page.getByRole('navigation', { name: 'Worklist koder' });
    await nav.getByRole('button', { name: /Ny\. Siti Aminah/ }).click();
    await detail.getByRole('button', { name: 'Simulasikan jawaban DPJP' }).click();
    await expect(detail.getByText(/✓ Dijawab/)).toBeVisible();
    await expect(detail.getByRole('button', { name: 'Validasi dan teruskan ke grouping' })).toBeEnabled();

    await nav.getByRole('button', { name: /Tn\. Joko Susilo/ }).click();
    await expect(detail.getByText('Pertanyaan verifikator', { exact: true })).toBeVisible();
    await detail
      .getByRole('listitem', { name: 'Kode E87.5' })
      .getByRole('button', { name: 'Hapus E87.5 di versi baru' })
      .click();
    const save = detail.getByRole('button', { name: 'Simpan versi 2 dan siapkan tanggapan' });
    await expect(save).toBeDisabled();
    await detail
      .getByLabel(/Alasan versi koding baru/)
      .fill('Kalium tunggal tidak bermakna klinis menurut DPJP');
    await save.click();
    await expect(page.getByText(/Versi koding 2 Tn\. Joko Susilo disimpan/)).toBeVisible();
    await noHorizontalOverflow(page);
  });
});

test.describe('jasa pelayanan (U08)', () => {
  test('akuntan tertahan gerbang; manajemen menyetujui → akrual terposting; September terkunci', async ({
    page,
    browser,
  }) => {
    const akuntan = await createAccount({ roles: ['akuntan'] });
    await loginAs(page, akuntan, '/keuangan/jasa-pelayanan');
    await page.goto('/keuangan/jasa-pelayanan');
    await expect(
      page.getByRole('heading', { name: 'Jasa pelayanan · rekap per PPA', level: 1 }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Setujui rekap dan posting akrual' })).toBeDisabled();
    await expect(page.getByText('Persetujuan rekap oleh posisi manajemen.')).toBeVisible();
    await journalsBalanced(page, 2);
    await page.getByRole('radio', { name: /September 2026/ }).click();
    await expect(page.getByRole('button', { name: 'Hitung ulang' })).toBeDisabled();
    await expect(page.getByText('Terkunci: periode September 2026 ditutup.')).toBeVisible();

    const direktur = await createAccount({ roles: ['manajemen'] });
    const ctx = await browser.newContext({
      baseURL: test.info().project.use.baseURL,
      viewport: test.info().project.use.viewport,
      locale: 'id-ID',
      timezoneId: 'Asia/Jakarta',
    });
    const mgr = await ctx.newPage();
    await loginAs(mgr, direktur, '/keuangan/jasa-pelayanan');
    await mgr.goto('/keuangan/jasa-pelayanan');
    await mgr.getByRole('button', { name: 'Setujui rekap dan posting akrual' }).click();
    await expect(
      mgr.getByText(/Rekap jasa Oktober disetujui manajemen · \d{2}\.\d{2} · Dr 5-1100/),
    ).toBeVisible();
    await expect(mgr.getByText('Pembayaran jasa diposting posisi akuntan.')).toBeVisible();
    await mgr.getByRole('button', { name: 'Ekspor CSV' }).click();
    await expect(mgr.getByLabel('Pratinjau CSV')).toContainText('PPA;Jumlah tindakan;Bruto;PPh 21;Neto');
    await noHorizontalOverflow(mgr);
    await ctx.close();
  });
});

test.describe('kas dan bank (U09)', () => {
  test('tutup laci: selisih wajib alasan, setoran berjurnal; padanan EDC, pengecualian, lepas padanan', async ({
    page,
  }) => {
    const kasir = await createAccount({ roles: ['kasir'] });
    await loginAs(page, kasir, '/keuangan/kas-bank');
    await page.goto('/keuangan/kas-bank');
    await expect(page.getByRole('heading', { name: /Kas & bank · laci kasir/, level: 1 })).toBeVisible();

    const laci = page.getByRole('article', { name: 'Laci Loket 1 · RJ dan RI' });
    await expect(laci.locator('[data-expected]')).toHaveText('Rp 4.208.400');
    await laci.getByRole('button', { name: 'Tutup laci…' }).click();
    const form = laci.getByRole('form', { name: /Tutup laci Loket 1/ });
    await form.getByLabel('Rp 100.000', { exact: true }).fill('42');
    await form.getByLabel('Rp 5.000', { exact: true }).fill('1');
    await form.getByLabel('Rp 2.000', { exact: true }).fill('1');
    await form.getByLabel('Rp 1.000', { exact: true }).fill('1');
    await expect(form.getByText('kurang Rp 400')).toBeVisible();
    const close = form.getByRole('button', { name: 'Tutup laci dan buat setoran' });
    await expect(close).toBeDisabled();
    await form.getByLabel(/Alasan selisih/).fill('Kembalian pecahan Rp 200 dua kali tidak dicatat');
    await journalsBalanced(form);
    await close.click();
    await expect(
      page.getByText(/Laci Loket 1 · RJ dan RI ditutup \d{2}\.\d{2} · setoran STR-2610-0413 Rp 3\.708\.000/),
    ).toBeVisible();

    await page.getByRole('tab', { name: /Mutasi bank/ }).click();
    const edc = page.getByRole('listitem', { name: /SETTLEMENT EDC/ });
    await journalsBalanced(edc);
    await edc.getByRole('button', { name: /Padankan ke Batch EDC/ }).click();
    await expect(
      page.getByText(/dipadankan ke Batch EDC RI-01 .* Dr 1-1120 Rp 9\.850\.000 · Dr 6-1200 Rp 150\.000/),
    ).toBeVisible();
    const anon = page.getByRole('listitem', { name: /TANPA BERITA/ });
    await anon.getByRole('button', { name: 'Tandai pengecualian…' }).click();
    await anon.getByLabel(/Catatan pengecualian/).fill('Ditelusuri ke pengirim lewat BTN');
    await anon.getByRole('button', { name: 'Catat pengecualian' }).click();
    await expect(anon.getByText('Pengecualian', { exact: true })).toBeVisible();
    await edc.getByRole('button', { name: 'Lepas padanan…' }).click();
    await edc.getByLabel(/Alasan melepas padanan/).fill('Batch EDC salah terminal');
    await edc.getByRole('button', { name: 'Lepas padanan' }).click();
    await expect(page.getByText(/Padanan SETTLEMENT EDC .* dilepas .* jurnal balik Dr 1-1210/)).toBeVisible();
    await expect(
      page.getByRole('listitem', { name: /BUNGA JASA GIRO/ }).getByText(/Terkunci: periode September 2026/),
    ).toBeVisible();
    await noHorizontalOverflow(page);
  });
});
