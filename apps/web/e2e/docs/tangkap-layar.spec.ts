import { expect, type Page, test } from '@playwright/test';
import { SCREENS, type ScreenDef } from '../../src/lib/screens';
import { CONSENT_ID, ENCOUNTER_ID, INVOICE_ID } from '../../src/lib/demo/fixtures/ids';
import { DOCS_CAPTURE, openAs, shoot, watchErrors } from './capture';

/**
 * Tangkap layar dokumentasi · mode presentasi (ADR-0023). Untuk SETIAP layar berstatus `demo` di registri `SCREENS`
 * satu gambar `docs/panduan/gambar/<id>.png` dengan posisi pemakai pertamanya (`demoRoles`), lalu langkah kunci alur
 * (gerbang CDS, read-back nilai kritis, gelang eMAR, …) sebagai `<id>--<langkah>.png`. Layar baru di registri ikut
 * tertangkap otomatis; rute berparameter dan langkah kunci didaftarkan di bawah.
 *
 * Jalankan: `pnpm docs:gambar` (DOCS_CAPTURE=1, proyek Playwright `docs` + `docs-api`). Tanpa DOCS_CAPTURE dilewati.
 */

test.skip(!DOCS_CAPTURE, 'Hanya dengan DOCS_CAPTURE=1 (pnpm docs:gambar)');

/** Rute contoh untuk layar yang tidak punya halaman indeks bermakna (pasien biasa, bukan pasien skenario). */
const MAIN_PATH: Record<string, string> = {
  resume: `/klinis/resume/${ENCOUNTER_ID.endang}`,
  consent: `/tablet/persetujuan/${CONSENT_ID.hendro}`,
};

/** Posisi pembuka: pemakai pertama di registri ('semua' → dokter, posisi yang paling banyak membuka layar). */
function roleOf(screen: ScreenDef): string {
  return screen.demoRoles === 'semua' ? 'dokter' : (screen.demoRoles[0] ?? 'dokter');
}

const demoScreens = SCREENS.filter((s) => s.status === 'demo' && !s.apiOnly);

/** Buka, periksa tanpa galat dan tanpa ajakan "ganti posisi", lalu tangkap. */
async function captureScreen(page: Page, info: Parameters<typeof shoot>[1], name: string, path: string) {
  const errors = watchErrors(page);
  const res = await page.goto(path);
  expect(res?.status(), `${path}: status HTTP`).toBe(200);
  await expect(page.getByText('Layar ini untuk posisi lain')).toHaveCount(0);
  await shoot(page, info, name);
  expect(errors(), `${path}: galat JavaScript`).toEqual([]);
}

test.describe('dokumentasi · layar mode presentasi', () => {
  for (const screen of demoScreens) {
    test(`${screen.id} (${roleOf(screen)})`, async ({ page }, info) => {
      const path = MAIN_PATH[screen.id] ?? screen.route;
      await openAs(page, roleOf(screen), path);
      await captureScreen(page, info, screen.id, path);
    });
  }
});

/** Lompat skenario Simulasi ke tahap `stage` (tab skenario opsional). */
async function jumpTo(page: Page, stage: string, tab?: string) {
  await page.goto('/simulasi');
  if (tab) await page.getByRole('tab', { name: tab }).click();
  await page.getByText('Lompat ke tahap', { exact: true }).click();
  await page.getByRole('button', { name: new RegExp(`^\\d+\\. ${stage}$`) }).click();
  await expect(page.getByText(new RegExp(`Langkah \\d+ dari \\d+ · ${stage}`))).toBeVisible();
}

test.describe('dokumentasi · langkah kunci alur', () => {
  test('order--detail dan order--cds-blokir (CPOE, alergi amoksisilin)', async ({ page }, info) => {
    const path = `/klinis/order/${ENCOUNTER_ID.rohana}`;
    await openAs(page, 'dokter', path);
    await captureScreen(page, info, 'order--detail', path);
    await page.getByLabel('Cari pemeriksaan, obat, tindakan').fill('amoksisilin');
    await page.getByRole('button', { name: /Tambah Amoksisilin 500 mg kapsul/ }).click();
    const gate = page.getByRole('alert').filter({ hasText: 'CDS memblokir Amoksisilin 500 mg kapsul' });
    await expect(gate).toBeVisible();
    await gate.getByRole('button', { name: 'Override dengan alasan' }).click();
    await shoot(page, info, 'order--cds-blokir', { focus: gate });
  });

  test('ranap--detail dan ranap--emar-terbuka (gelang dipindai)', async ({ page }, info) => {
    const path = `/klinis/rawat-inap/${ENCOUNTER_ID.endang}`;
    await openAs(page, 'perawat', path);
    await captureScreen(page, info, 'ranap--detail', path);
    const emar = page.getByRole('region', { name: 'eMAR' });
    await emar.getByRole('button', { name: 'Pindai gelang', exact: true }).click();
    await expect(emar.getByText(/Pasien benar · gelang terpindai/)).toBeVisible();
    await emar.getByRole('button', { name: /^Insulin aspart sesuai skala jam 12\.00/ }).click();
    await shoot(page, info, 'ranap--emar-terbuka', { focus: emar });
  });

  test('igd--triase (panel triase dengan saran sistem)', async ({ page }, info) => {
    await openAs(page, 'perawat', '/klinis/igd');
    const board = page.getByRole('region', { name: 'Papan pasien IGD' });
    await board.getByRole('button', { name: /Ny\. Lestiani Hapsari/ }).click();
    const panel = page.getByRole('complementary', { name: 'Triase pasien' });
    await expect(panel.getByRole('heading', { name: /Ny\. Lestiani Hapsari/ })).toBeVisible();
    await shoot(page, info, 'igd--triase', { focus: panel });
  });

  test('lab--nilai-kritis (pelaporan dengan read-back)', async ({ page }, info) => {
    await openAs(page, 'analis_lab', '/penunjang/lab');
    const kritis = page.getByRole('region', { name: /Nilai kritis terbuka · Tn\. Yusuf Hidayat/ });
    await kritis.getByRole('button', { name: 'Catat pelaporan' }).click();
    await kritis
      .getByRole('textbox', { name: 'Nama penerima laporan (DPJP / dokter jaga)' })
      .fill('dr. Sinta Maharani, Sp.PD-KGH');
    await shoot(page, info, 'lab--nilai-kritis', { focus: kritis });
  });

  test('farmasi--cds (telaah resep ditahan peringatan CDS)', async ({ page }, info) => {
    await openAs(page, 'apoteker', '/penunjang/farmasi');
    await page
      .getByRole('region', { name: 'Antrean telaah' })
      .getByRole('button', { name: /Tn\. Sutan Batubara/ })
      .click();
    await expect(page.getByText(/Tindak lanjuti 2 peringatan CDS/)).toBeVisible();
    await shoot(page, info, 'farmasi--cds', { focus: page.getByRole('region', { name: 'Item resep' }) });
  });

  test('ok--time-out (insisi terkunci sampai time out lengkap)', async ({ page }, info) => {
    await openAs(page, 'dokter', '/penunjang/kamar-operasi');
    const tilik = page.getByRole('region', { name: 'Daftar tilik keselamatan' });
    const signIn = tilik.getByRole('group', { name: 'Sign in', exact: true });
    for (const box of await signIn.getByRole('checkbox').all()) await box.check();
    await tilik.getByRole('button', { name: 'Konfirmasi sign in' }).click();
    await expect(page.getByText('Insisi terkunci: time out belum lengkap')).toBeVisible();
    await shoot(page, info, 'ok--time-out', { focus: tilik });
  });

  test('kasir--item-manual (item manual ditahan tanpa alasan)', async ({ page }, info) => {
    const path = `/keuangan/kasir?pilih=${INVOICE_ID.ayu}`;
    await openAs(page, 'kasir', path);
    await page.getByRole('button', { name: 'Tambah item manual' }).click();
    const form = page.getByRole('form', { name: 'Tambah item manual' });
    await form.getByLabel('Nama item').fill('Nebulisasi tambahan');
    await form.getByLabel('Kuantitas').fill('1');
    await form.getByLabel('Harga satuan (Rp)').fill('35000');
    await expect(form.getByText(/Belum bisa diajukan: tulis alasan/)).toBeVisible();
    await shoot(page, info, 'kasir--item-manual', { focus: form });
  });

  test('daftar--sep (SEP terbit di alur pendaftaran)', async ({ page }, info) => {
    await openAs(page, 'petugas_pendaftaran', '/pendaftaran');
    await page.getByLabel('Cari pasien (NIK, No. RM, No. BPJS, nama + tgl lahir)').fill('00-12-45-78');
    await page.getByRole('button', { name: 'Cari pasien', exact: true }).click();
    await page.getByRole('button', { name: 'Cek kepesertaan', exact: true }).click();
    await expect(page.getByText('AKTIF', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: /Surat kontrol · Poli Penyakit Dalam/ }).click();
    await page.getByRole('button', { name: 'Terbitkan SEP dan daftarkan', exact: true }).click();
    const sep = page.getByText(/SEP 0301R0011026V000812 terbit pukul \d{2}\.\d{2}/);
    await expect(sep).toBeVisible();
    await shoot(page, info, 'daftar--sep', { focus: sep });
  });

  test('kiosk--tiket (check-in kode booking sampai tiket)', async ({ page }, info) => {
    await openAs(page, 'petugas_pendaftaran', '/kiosk');
    const kiosk = page.getByRole('region', { name: 'Anjungan pendaftaran mandiri' });
    await kiosk.getByRole('button', { name: /Saya sudah punya booking/ }).click();
    await kiosk.getByRole('button', { name: /^Kode booking/ }).click();
    for (const d of '1234567890')
      await kiosk.getByRole('button', { name: `Angka ${d}`, exact: true }).click();
    await kiosk.getByRole('button', { name: 'Lanjut', exact: true }).click();
    await kiosk.getByRole('button', { name: /Pengenalan wajah/ }).click();
    await kiosk.getByRole('button', { name: 'Ya, data saya benar · cetak tiket' }).click();
    await expect(kiosk.getByRole('region', { name: 'Tiket antrean' })).toBeVisible();
    await shoot(page, info, 'kiosk--tiket');
  });

  test('integrasi--dlq (saring DLQ per tujuan)', async ({ page }, info) => {
    await openAs(page, 'admin_tenant', '/sistem/integrasi');
    await page
      .getByRole('region', { name: 'Status antarmuka' })
      .getByRole('button', { name: /PACS radiologi/ })
      .click();
    const dlq = page.getByRole('region', { name: 'Dead-letter queue' });
    await dlq.getByRole('checkbox', { name: /RAD-2610-118/ }).check();
    await shoot(page, info, 'integrasi--dlq', { focus: dlq });
  });

  test('simulasi--igd dan simulasi--ringkasan', async ({ page }, info) => {
    await openAs(page, 'perawat', '/simulasi');
    await jumpTo(page, 'Triase', 'IGD → rawat inap');
    await shoot(page, info, 'simulasi--igd');

    await jumpTo(page, 'Pasca kunjungan', 'Rawat jalan BPJS');
    await page.getByRole('button', { name: 'Kirim notifikasi' }).click();
    await page.getByRole('button', { name: /Rujuk balik ke FKTP/ }).click();
    await page.getByRole('button', { name: 'Kirim berkas klaim' }).click();
    await page.getByRole('button', { name: 'Selesaikan simulasi' }).click();
    await expect(page.getByText('Simulasi selesai', { exact: true })).toBeVisible();
    await shoot(page, info, 'simulasi--ringkasan');
  });
});

test.describe('dokumentasi · langkah kunci putaran 2 (FE1–FE5)', () => {
  test('downtime--aktif (mode downtime beralasan)', async ({ page }, info) => {
    await openAs(page, 'admin_tenant', '/sistem/downtime');
    await page
      .getByLabel('Alasan dan dampak (tercatat di log insiden)')
      .fill('VClaim timeout sejak 10.40, SEP tidak terbit');
    await page.getByRole('button', { name: 'Aktifkan mode downtime' }).click();
    await page
      .getByRole('alertdialog', { name: 'Aktifkan mode downtime?' })
      .getByRole('button', { name: 'Ya, aktifkan' })
      .click();
    await expect(page.getByRole('alert').filter({ hasText: 'Mode downtime aktif sejak' })).toBeVisible();
    await shoot(page, info, 'downtime--aktif');
  });

  test('golive--matriks (GO terkunci sampai item kritis selesai)', async ({ page }, info) => {
    await openAs(page, 'manajemen', '/sistem/go-live');
    await page
      .getByLabel('Catatan keputusan (wajib, tercatat)')
      .fill('Pilot mulai Senin 12 Okt, hypercare 2 minggu');
    const locked = page.getByText('Terkunci: 3 item kritis belum selesai atau belum berpemilik.');
    await expect(locked).toBeVisible();
    await shoot(page, info, 'golive--matriks', { focus: locked });
  });

  test('cppt--cosign (CPPT residen menunggu co-sign DPJP)', async ({ page }, info) => {
    await openAs(page, 'dokter_residen', '/klinis/cppt');
    await page.getByRole('button', { name: '+ Tulis CPPT (SOAP)' }).click();
    const form = page.getByRole('form', { name: 'Tulis CPPT baru' });
    await form.getByLabel('S · Subjektif').fill('Mual berkurang, nafsu makan membaik.');
    await form.getByLabel('A · Asesmen').fill('Hiperglikemia membaik.');
    await form.getByLabel('P · Rencana').fill('Insulin aspart 6 U sebelum makan siang.');
    await form.getByRole('button', { name: 'Simpan dan ajukan co-sign DPJP' }).click();
    const status = page.getByRole('status').filter({ hasText: 'menunggu co-sign DPJP' });
    await expect(status).toBeVisible();
    const mine = page
      .getByRole('list', { name: 'Catatan CPPT' })
      .getByRole('listitem')
      .filter({ hasText: 'Hiperglikemia membaik.' });
    await shoot(page, info, 'cppt--cosign', { focus: mine });
  });

  test('askep--gelang (pemberian obat terkunci sampai gelang cocok)', async ({ page }, info) => {
    await openAs(page, 'perawat', '/klinis/asuhan-keperawatan');
    const ronde = page.getByRole('region', { name: 'Ronde obat shift' });
    await ronde.getByLabel('Kode gelang (hasil pindai)').fill('00-12-45-78');
    await ronde.getByRole('button', { name: 'Verifikasi gelang' }).click();
    await expect(ronde.getByRole('alert')).toContainText('Gelang tidak cocok');
    await shoot(page, info, 'askep--gelang', { focus: ronde });
  });

  test('kelengkapan--tutup (tutup kunjungan terkunci)', async ({ page }, info) => {
    await openAs(page, 'dokter', '/klinis/kelengkapan');
    const cek = page.getByRole('region', { name: 'Kelengkapan rekam medis' });
    await expect(cek.getByRole('button', { name: 'Tutup kunjungan' })).toBeDisabled();
    await shoot(page, info, 'kelengkapan--tutup', {
      focus: cek.getByRole('button', { name: 'Tutup kunjungan' }),
    });
  });

  test('kritis--read-back (penerima + read-back wajib)', async ({ page }, info) => {
    await openAs(page, 'analis_lab', '/penunjang/hasil-kritis');
    await page
      .getByRole('region', { name: 'Daftar hasil kritis' })
      .getByRole('button', { name: /Tn\. Yusuf Hidayat/ })
      .click();
    const detail = page.getByRole('region', { name: 'Detail hasil kritis' });
    await detail.getByRole('button', { name: 'Catat pelaporan' }).click();
    const form = detail.getByRole('form', { name: 'Catat pelaporan hasil kritis' });
    await form.getByRole('radio', { name: /dr\. Sinta Maharani/ }).check();
    await form.getByRole('button', { name: 'Simpan pelaporan' }).click();
    await expect(form.getByText(/Read-back wajib/)).toBeVisible();
    await shoot(page, info, 'kritis--read-back', { focus: form });
  });

  test('depo--fefo (batch ED terdekat keluar dulu)', async ({ page }, info) => {
    await openAs(page, 'apoteker', '/penunjang/depo');
    await page.getByRole('tab', { name: 'Keluarkan (FEFO)' }).click();
    await page
      .getByRole('region', { name: 'Permintaan menunggu' })
      .getByRole('listitem')
      .filter({ hasText: 'Seftriakson' })
      .getByRole('button', { name: 'Siapkan' })
      .click();
    const form = page.getByRole('form', { name: 'Pengeluaran stok' });
    await expect(form).toContainText('CFX2510');
    await shoot(page, info, 'depo--fefo', { focus: form });
  });

  test('bank-darah--cek-ganda (dua petugas sebelum kantong keluar)', async ({ page }, info) => {
    await openAs(page, 'analis_lab', '/penunjang/bank-darah');
    await page
      .getByRole('region', { name: 'Permintaan darah' })
      .getByRole('button', { name: /Ny\. Anisa Rahmadani/ })
      .click();
    const detail = page.getByRole('region', { name: 'Detail permintaan darah' });
    const cross = detail.getByRole('region', { name: 'Crossmatch' });
    await cross
      .getByRole('listitem')
      .filter({ hasText: 'KD-261001-044' })
      .getByRole('button', { name: 'Hasil kompatibel' })
      .click();
    const issue = detail.getByRole('form', { name: 'Cek ganda pengeluaran kantong' });
    await issue.getByRole('button', { name: 'Keluarkan kantong' }).click();
    await expect(detail.getByRole('alert').filter({ hasText: 'dua petugas' })).toBeVisible();
    await shoot(page, info, 'bank-darah--cek-ganda', { focus: issue });
  });

  test('satusehat--tahan (resource anak ditahan menunggu Encounter)', async ({ page }, info) => {
    await openAs(page, 'admin_tenant', '/sistem/integrasi/satusehat');
    await page
      .getByRole('region', { name: 'Kunjungan' })
      .getByRole('button', { name: /Ny\. Fransiska/ })
      .click();
    const detail = page.getByRole('region', { name: 'Detail kunjungan SATUSEHAT' });
    await expect(detail.getByRole('row', { name: /Condition/ })).toContainText('menunggu Encounter terkirim');
    await shoot(page, info, 'satusehat--tahan', { focus: detail });
  });

  test('kas-bank--jurnal (tutup laci: selisih beralasan, jurnal seimbang)', async ({ page }, info) => {
    await openAs(page, 'kasir', '/keuangan/kas-bank');
    const laci = page.getByRole('article', { name: 'Laci Loket 1 · RJ dan RI' });
    await laci.getByRole('button', { name: 'Tutup laci…' }).click();
    const form = laci.getByRole('form', { name: /Tutup laci Loket 1/ });
    await form.getByLabel('Rp 100.000', { exact: true }).fill('42');
    await form.getByLabel('Rp 5.000', { exact: true }).fill('1');
    await form.getByLabel('Rp 2.000', { exact: true }).fill('1');
    await form.getByLabel('Rp 1.000', { exact: true }).fill('1');
    await form.getByLabel(/Alasan selisih/).fill('Kembalian pecahan Rp 200 dua kali tidak dicatat');
    const journal = form.locator('figure:has([data-total-debit])').first();
    await expect(journal).toBeVisible();
    await shoot(page, info, 'kas-bank--jurnal', { focus: journal });
  });

  test('hutang--persetujuan (persetujuan tingkat 2 oleh manajemen)', async ({ page }, info) => {
    await openAs(page, 'manajemen', '/keuangan/hutang');
    const ek = page.getByRole('listitem', { name: 'Faktur EK/2609/55120' });
    await expect(ek.getByRole('button', { name: 'Setujui tingkat 2' })).toBeVisible();
    await shoot(page, info, 'hutang--persetujuan', { focus: ek });
  });

  test('command-center--alert (alert kritis wajib keputusan beralasan)', async ({ page }, info) => {
    await openAs(page, 'manajemen', '/manajemen/command-center');
    const alerts = page.getByRole('region', { name: 'Alert keputusan' });
    await alerts.getByRole('button', { name: /Putuskan tindakan.*1 pasien IGD menunggu bed/ }).click();
    await expect(alerts.getByRole('button', { name: 'Simpan keputusan' })).toBeDisabled();
    await shoot(page, info, 'command-center--alert', { focus: alerts });
  });
});
