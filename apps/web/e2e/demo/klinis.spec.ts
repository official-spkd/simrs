import { expect, type Page, test } from '@playwright/test';
import { createAccount, loginAs } from '../support/accounts';
import { ENCOUNTER_ID, PATIENT_ID } from '../../src/lib/demo/fixtures/ids';

/** Pemeriksaan poli (K01/K02) dan CPOE + CDS (K09) — mode presentasi, ADR-0023; mockup Main dan CPOE. */

async function noHorizontalOverflowAtTablet(page: Page) {
  await page.setViewportSize({ width: 768, height: 1024 });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

const banner = (page: Page) => page.locator('[aria-label="Identitas pasien"]');

/** Lompat skenario Simulasi aktif (rawat jalan) ke tahap `stage` lewat "Lompat ke tahap". */
async function jumpTo(page: Page, stage: string) {
  await page.goto('/simulasi');
  await page.getByText('Lompat ke tahap', { exact: true }).click();
  await page.getByRole('button', { name: new RegExp(`^\\d+\\. ${stage}$`) }).click();
  await expect(page.getByText(new RegExp(`Langkah \\d+ dari \\d+ · ${stage}`))).toBeVisible();
}

test.describe('klinis rawat jalan', () => {
  test('poli: antrean, banner pasien dengan alergi, tanda vital, tanda tangan butuh diagnosis', async ({
    page,
  }) => {
    const dokter = await createAccount({ roles: ['dokter'] });
    await loginAs(page, dokter, '/klinis/poli');
    await page.goto('/klinis/poli');
    await expect(page.getByRole('heading', { name: 'Pemeriksaan pasien', level: 1 })).toBeVisible();

    const queue = page.getByRole('region', { name: 'Antrean poli' });
    await expect(queue.getByRole('link')).toHaveCount(7);
    await expect(queue.getByRole('button', { name: 'Panggil berikutnya · PD-026' })).toBeEnabled();
    await queue.getByLabel('Cari pasien').fill('00315746');
    await expect(queue.getByRole('link')).toHaveCount(1);
    await expect(queue.getByRole('link', { name: /Ny\. Sri Wahyuni/ })).toBeVisible();
    await queue.getByLabel('Cari pasien').fill('');
    await queue.getByRole('button', { name: 'Hasil 1' }).click();
    await expect(queue.getByRole('link')).toHaveCount(1);
    await expect(queue.getByRole('link', { name: /Ny\. Dewi Kurniasih/ })).toContainText('Menunggu hasil');
    await queue.getByRole('button', { name: 'Semua 7' }).click();
    await queue.getByRole('link', { name: /Ny\. Rohana Siregar/ }).click();
    await expect(page).toHaveURL(new RegExp(`pasien=${PATIENT_ID.rohana}`));

    await expect(banner(page).getByText('Ny. Rohana Siregar')).toBeVisible();
    await expect(banner(page).getByText('Alergi: Amoksisilin')).toBeVisible();
    await expect(page.getByText(/^NIK 9999•+\d{4}$/)).toBeVisible();
    const vitals = page.getByRole('region', { name: 'Tanda vital' });
    await expect(vitals.getByText('TANDA VITAL · diukur perawat 07.36')).toBeVisible();
    await expect(vitals.getByText('132/84').first()).toBeVisible();

    // Mockup Main: catatan pasien yang sedang diperiksa, tahapan di "Pemeriksaan", surat kontrol menunggu.
    const stepper = page.getByRole('list', { name: 'Tahapan kunjungan' });
    const docs = page.getByRole('region', { name: 'Dokumen kunjungan' });
    await expect(docs).toContainText(/Surat (kontrol|keterangan)\s*Menunggu/);

    const sign = page.getByRole('button', { name: 'Tanda tangani dan selesai' });
    await expect(sign).toBeDisabled();
    await expect(
      page.getByText('Isi minimal satu diagnosis (A · Asesmen ICD-10) agar kunjungan bisa diselesaikan.'),
    ).toBeVisible();
    await page.getByRole('button', { name: '+ Tambah diagnosis' }).click();
    await page.getByLabel('Pilih kode ICD-10').selectOption('E11.9');
    await expect(page.getByText('Diabetes melitus tipe 2 tanpa komplikasi').first()).toBeVisible();
    await expect(sign).toBeEnabled();
    await sign.click();
    await expect(page.getByText(/^Ditandatangani \d{2}\.\d{2} · CPPT versi final$/)).toBeVisible();
    await expect(page.getByText(/Kunjungan selesai · ditandatangani \d{2}\.\d{2}/)).toBeVisible();
    await expect(queue.getByRole('link', { name: /Ny\. Rohana Siregar/ })).toContainText('Selesai');
    // Setelah tanda tangan: tahapan maju ke Kasir dan surat kontrol/keterangan tercatat dibuat (mockup Main).
    await expect(stepper.locator('[aria-current="step"]')).toContainText('Kasir');
    await expect(docs).toContainText(/Surat (kontrol|keterangan)\s*✓ Dibuat/);

    // Bertahan (toko demo `klinis-poli`): setelah muat ulang kunjungan tetap selesai dengan diagnosisnya.
    await page.reload();
    await expect(page.getByText(/Kunjungan selesai · ditandatangani \d{2}\.\d{2}/)).toBeVisible();
    await expect(queue.getByRole('link', { name: /Ny\. Rohana Siregar/ })).toContainText('Selesai');
    await expect(page.getByText('Diabetes melitus tipe 2 tanpa komplikasi').first()).toBeVisible();

    // Panggil berikutnya mengembalikan filter ke "Semua" agar pasien yang dipanggil tetap terlihat.
    await queue.getByRole('button', { name: /^Hasil \d+$/ }).click();
    await queue.getByRole('button', { name: /^Panggil berikutnya · / }).click();
    await expect(queue.getByRole('button', { name: /^Semua \d+$/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText(/dibuat \d{2}\.\d{2} · versi 1 \(draf\)/)).toBeVisible();

    await noHorizontalOverflowAtTablet(page);
  });

  test('CPOE: amoksisilin diblokir CDS sampai alasan override ≥ 10 karakter; kirim tertahan dengan alasan', async ({
    page,
  }) => {
    const dokter = await createAccount({ roles: ['dokter'] });
    await loginAs(page, dokter, `/klinis/order/${ENCOUNTER_ID.rohana}`);
    await page.goto(`/klinis/order/${ENCOUNTER_ID.rohana}`);
    await expect(page.getByRole('heading', { name: 'Order & resep (CPOE)', level: 1 })).toBeVisible();
    await expect(banner(page).getByText('Alergi: Amoksisilin')).toBeVisible();

    const send = page.getByRole('button', { name: /^Tanda tangani dan kirim \d+ order$/ });
    await expect(send).toBeEnabled();
    await page.getByLabel('Cari pemeriksaan, obat, tindakan').fill('amoksisilin');
    await page.getByRole('button', { name: /Tambah Amoksisilin 500 mg kapsul/ }).click();

    const gate = page.getByRole('alert').filter({ hasText: 'CDS memblokir Amoksisilin 500 mg kapsul' });
    await expect(gate).toContainText('pasien alergi amoksisilin');
    await expect(send).toBeDisabled();
    await expect(page.getByText(/Belum bisa dikirim: 1 order diblokir CDS \(amoksisilin\)/)).toBeVisible();

    await gate.getByRole('button', { name: 'Override dengan alasan' }).click();
    const reason = gate.getByLabel(/Alasan klinis/);
    await reason.fill('ruam');
    await expect(gate.getByRole('button', { name: 'Simpan alasan dan lanjut' })).toBeDisabled();
    await reason.fill('Ruam ringan 10 tahun lalu, uji kulit negatif');
    await gate.getByRole('button', { name: 'Simpan alasan dan lanjut' }).click();
    await expect(page.getByText(/Override alergi oleh .+ · alasan: Ruam ringan 10 tahun lalu/)).toBeVisible();

    await expect(send).toBeEnabled();
    await send.click();
    await expect(page.getByText(/^5 order terkirim pukul \d{2}\.\d{2}$/)).toBeVisible();
    await expect(page.getByRole('button', { name: /^Order terkirim · \d{2}\.\d{2}$/ })).toBeDisabled();

    // Bertahan (toko demo `klinis-order`): order yang ditandatangani tetap terkirim setelah muat ulang, berikut
    // alasan override CDS-nya; tidak ada draf yang bisa dihapus.
    await page.reload();
    await expect(page.getByText(/^5 order terkirim pukul \d{2}\.\d{2}$/)).toBeVisible();
    await expect(page.getByRole('button', { name: /^Order terkirim · \d{2}\.\d{2}$/ })).toBeDisabled();
    await expect(page.getByText(/alasan: Ruam ringan 10 tahun lalu/)).toBeVisible();

    // Mockup CPOE: menambah order setelah kirim membuka kiriman baru; order terkirim tetap terkunci.
    await page.getByLabel('Cari pemeriksaan, obat, tindakan').fill('lipid');
    await page.getByRole('button', { name: /^Tambah Profil lipid/ }).click();
    const again = page.getByRole('button', { name: 'Tanda tangani dan kirim 1 order' });
    await expect(again).toBeEnabled();
    await expect(page.getByRole('button', { name: /^Hapus Amoksisilin/ })).toHaveCount(0);
    await again.click();
    await expect(page.getByText(/^1 order terkirim pukul \d{2}\.\d{2}$/)).toBeVisible();

    await noHorizontalOverflowAtTablet(page);
  });

  test('CPOE: alternatif aman membuka blok (Tn. Darmawan, alergi ibuprofen)', async ({ page }) => {
    const dokter = await createAccount({ roles: ['dokter'] });
    await loginAs(page, dokter, `/klinis/order/${ENCOUNTER_ID.darmawan}`);
    await page.goto(`/klinis/order/${ENCOUNTER_ID.darmawan}`);
    const send = page.getByRole('button', { name: /^Tanda tangani dan kirim \d+ order$/ });
    await expect(send).toBeDisabled();
    const gate = page.getByRole('alert').filter({ hasText: 'CDS memblokir Asam mefenamat 500 mg tablet' });
    await gate.getByRole('button', { name: 'Ganti parasetamol 500 mg' }).click();
    await expect(page.getByText(/asam mefenamat 500 mg diganti parasetamol 500 mg/)).toBeVisible();
    await expect(send).toBeEnabled();
  });

  test('CSP ber-nonce (ADR-0073): layar poli terhidrasi tanpa pelanggaran CSP', async ({ page }) => {
    const violations: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error' && /Content Security Policy/i.test(m.text())) violations.push(m.text());
    });
    const dokter = await createAccount({ roles: ['dokter'] });
    await loginAs(page, dokter, '/klinis/poli');
    const res = await page.goto('/klinis/poli');
    const csp = res?.headers()['content-security-policy'] ?? '';
    expect(csp).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'(;|$)/);
    // Pencarian antrean berjalan di klien: hanya bekerja bila halaman terhidrasi.
    const queue = page.getByRole('region', { name: 'Antrean poli' });
    await queue.getByLabel('Cari pasien').fill('00315746');
    await expect(queue.getByRole('link')).toHaveCount(1);
    await expect(queue.getByRole('link', { name: /Ny\. Sri Wahyuni/ })).toBeVisible();
    expect(violations).toEqual([]);
  });

  test('kunjungan tak dikenal → 404 di pemeriksaan poli dan CPOE (bukan membuka pasien lain)', async ({
    page,
  }) => {
    const dokter = await createAccount({ roles: ['dokter'] });
    await loginAs(page, dokter, '/klinis/poli');
    for (const path of [
      '/klinis/poli?pasien=ps-tidak-ada',
      // Pasien dikenal, tetapi kunjungan polinya belum ada hari ini (Tn. Suryo sebelum SEP terbit).
      `/klinis/poli?pasien=${PATIENT_ID.suryo}`,
      '/klinis/order/kj-tidak-ada',
    ]) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBe(404);
      await expect(page.getByRole('heading', { name: 'Pemeriksaan pasien', level: 1 })).toHaveCount(0);
      await expect(page.getByRole('heading', { name: 'Order & resep (CPOE)', level: 1 })).toHaveCount(0);
    }
    const ok = await page.goto(`/klinis/poli?pasien=${PATIENT_ID.rohana}`);
    expect(ok?.status()).toBe(200);
    await expect(banner(page).getByText('Ny. Rohana Siregar')).toBeVisible();
  });

  test('perawat: asesmen tanda vital tervalidasi; CPOE hanya untuk dokter', async ({ page }) => {
    const perawat = await createAccount({ roles: ['perawat'] });
    await loginAs(page, perawat, `/klinis/poli?pasien=${PATIENT_ID.darmawan}`);
    await page.goto(`/klinis/poli?pasien=${PATIENT_ID.darmawan}`);
    await expect(banner(page).getByText('Alergi: Ibuprofen')).toBeVisible();
    await expect(page.getByText(/CPPT dokter hanya bisa diubah posisi dokter/)).toBeVisible();
    // Order dan resep hanya untuk posisi dokter: perawat tidak melihat tautan CPOE di rencana.
    await expect(page.getByRole('link', { name: 'Tulis resep (CPOE)' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Ukur ulang tanda vital' }).click();
    await page.getByLabel('Tekanan darah (mmHg)').fill('15096');
    await page.getByRole('button', { name: 'Simpan tanda vital' }).click();
    await expect(page.getByText('Isi dengan format sistolik/diastolik, mis. 120/80.')).toBeVisible();
    await page.getByLabel('Tekanan darah (mmHg)').fill('150/96');
    await page.getByRole('button', { name: 'Simpan tanda vital' }).click();
    await expect(page.getByText(/^Tanda vital tersimpan \d{2}\.\d{2}$/)).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Tanda vital' }).getByText('Tinggi', { exact: true }),
    ).toBeVisible();

    await page.goto(`/klinis/order/${ENCOUNTER_ID.darmawan}`);
    await expect(page.getByText('Layar ini untuk posisi lain')).toBeVisible();
  });

  test('CPOE pasien skenario di luar langkah resep: terkunci, tidak bisa dikirim, alasannya tertulis', async ({
    page,
  }) => {
    const dokter = await createAccount({ roles: ['dokter'] });
    await loginAs(page, dokter, `/klinis/order/${ENCOUNTER_ID.suryo}`);
    const locked = 'Pasien simulasi: order mengikuti langkah skenario.';
    const why = `${locked} Tidak ada langkah order yang aktif untuk pasien ini.`;

    // Akun baru = skenario di langkah awal (kedatangan), lalu tepat sebelum langkah resep (laboratorium).
    for (const stage of [null, 'Laboratorium']) {
      if (stage) await jumpTo(page, stage);
      await page.goto(`/klinis/order/${ENCOUNTER_ID.suryo}`);
      await expect(page.getByRole('heading', { name: 'Order & resep (CPOE)', level: 1 })).toBeVisible();
      const catalog = page.getByRole('complementary', { name: 'Katalog dan order set' });
      await expect(catalog.getByText(locked)).toBeVisible();
      await expect(catalog.getByLabel('Cari pemeriksaan, obat, tindakan')).toBeDisabled();
      const send = page.getByRole('button', { name: 'Kirim order (TTE)' });
      await expect(send).toBeDisabled();
      await expect(send).toHaveAccessibleDescription(why);
      await expect(page.getByText(why)).toBeVisible();
      await expect(page.getByRole('button', { name: 'Kirim resep (TTE)' })).toHaveCount(0);
      await expect(page.getByRole('region', { name: 'Rencana tata laksana' })).toHaveCount(0);
      // Tautan kembali ke pemeriksaan hanya bila kunjungan polinya ada (setelah SEP terbit), bukan berujung 404.
      await expect(page.getByRole('link', { name: 'Kembali ke pemeriksaan' })).toHaveCount(stage ? 1 : 0);
    }

    await page.getByRole('link', { name: 'Kembali ke pemeriksaan' }).click();
    await expect(page).toHaveURL(new RegExp(`/klinis/poli\\?pasien=${PATIENT_ID.suryo}$`));
    await expect(banner(page).getByText('Tn. Suryo Adi Nugroho')).toBeVisible();
  });

  test('CPOE pasien skenario (Tn. Suryo, langkah resep): katalog terkunci, kirim hanya lewat tugas skenario', async ({
    page,
  }) => {
    const dokter = await createAccount({ roles: ['dokter'] });
    await loginAs(page, dokter, '/simulasi');
    await jumpTo(page, 'Tinjau hasil & resep');
    await page.goto(`/klinis/order/${ENCOUNTER_ID.suryo}`);
    await expect(page.getByRole('heading', { name: 'Order & resep (CPOE)', level: 1 })).toBeVisible();

    // Katalog dan order set nonaktif dengan catatan tertulis: item tidak bisa ditambahkan lokal.
    const catalog = page.getByRole('complementary', { name: 'Katalog dan order set' });
    await expect(catalog.getByText('Pasien simulasi: order mengikuti langkah skenario.')).toBeVisible();
    await expect(catalog.getByLabel('Cari pemeriksaan, obat, tindakan')).toBeDisabled();
    for (const set of await catalog
      .getByRole('region', { name: 'Order set institusi' })
      .getByRole('button')
      .all())
      await expect(set).toBeDisabled();

    // Hanya kirim skenario (TTE), belum bisa sebelum rencana terapi dan PRB; tidak ada kirim order biasa.
    const send = page.getByRole('button', { name: 'Kirim resep (TTE)' });
    await expect(send).toBeDisabled();
    await expect(page.getByRole('button', { name: /^Tanda tangani dan kirim \d+ order$/ })).toHaveCount(0);

    const plan = page.getByRole('region', { name: 'Rencana tata laksana' });
    await plan.getByRole('button', { name: /Metformin \+ atorvastatin/ }).click();
    const list = page.getByRole('region', { name: 'Daftar order' });
    await expect(list.getByText('Draf skenario').first()).toBeVisible();
    await expect(list.getByRole('button', { name: /^Hapus / })).toHaveCount(0);

    await plan.getByRole('button', { name: /Tidak · resep 7 hari/ }).click();
    await expect(send).toBeEnabled();
    await send.click();
    await expect(page.getByText(/^Resep terkirim · \d{2}\.\d{2}$/)).toBeVisible();
  });
});

/** CLAUDE.md §6: status tidak hanya lewat warna (teks + ikon) dan target sentuh ≥ 44 px (K03, K05). */
test.describe('klinis IGD dan tempat tidur · status bertulisan', () => {
  test('IGD: lama tinggal lewat batas dan arah tanda vital abnormal tertulis', async ({ page }) => {
    const perawat = await createAccount({ roles: ['perawat'] });
    await loginAs(page, perawat, '/klinis/igd');
    await page.goto('/klinis/igd');
    const board = page.getByRole('region', { name: 'Papan pasien IGD' });
    const sumarni = board.getByRole('button', { name: /Ny\. Sumarni Pakpahan/ });
    await expect(sumarni).toContainText(/04\.4\d j/);
    await expect(sumarni).toContainText('Lewat 4 jam');
    await expect(board.getByRole('button', { name: /Ny\. Lestiani Hapsari/ })).not.toContainText('Lewat');

    await sumarni.click();
    const panel = page.getByRole('complementary', { name: 'Triase pasien' });
    await expect(panel.getByRole('heading', { name: /Ny\. Sumarni Pakpahan/ })).toBeVisible();
    await expect(panel.getByText('Lewat 4 jam')).toBeVisible();

    await board.getByRole('button', { name: /Tn\. X \(tanpa identitas\)/ }).click();
    const vitals = panel.getByRole('list', { name: 'Tanda vital' });
    const tile = (label: string) => vitals.getByRole('listitem').filter({ hasText: label });
    await expect(tile('TD')).toContainText('90/60');
    await expect(tile('TD')).toContainText('Rendah');
    await expect(tile('Nadi')).toContainText('Tinggi');
    await expect(tile('SpO2')).toContainText('Rendah');
    await expect(tile('Suhu')).not.toContainText(/Tinggi|Rendah|Abnormal/);
  });

  test('tempat tidur: permintaan terlambat bertulisan, chip bed ≥ 44 px, ruang hampir penuh', async ({
    page,
  }) => {
    const perawat = await createAccount({ roles: ['perawat'] });
    await loginAs(page, perawat, '/klinis/tempat-tidur');
    await page.goto('/klinis/tempat-tidur');
    const requests = page.getByRole('region', { name: 'Permintaan bed' });
    const request = (name: string) => requests.getByRole('listitem').filter({ hasText: name });
    await expect(request('Ny. Sumarni Pakpahan')).toContainText('4 j 40 m');
    await expect(request('Ny. Sumarni Pakpahan')).toContainText('Lewat 4 jam');
    await expect(request('Ny. Maria')).toContainText('terjadwal');
    await expect(request('Ny. Maria')).not.toContainText('Lewat');

    const chips = requests.getByRole('button', { name: /^Tampilkan bed .+ di peta/ });
    expect(await chips.count()).toBeGreaterThan(0);
    for (const chip of await chips.all()) {
      const box = await chip.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    }
    const code = (await chips.first().textContent())?.trim() ?? '';
    await chips.first().click();
    await expect(page.getByRole('region', { name: 'Bed terpilih' })).toContainText(code);

    await page.goto('/klinis/tempat-tidur?bangsal=semua');
    const map = page.getByRole('region', { name: 'Peta tempat tidur' });
    await expect(map.getByRole('listitem').filter({ hasText: 'ICU/ICCU' })).toContainText('Hampir penuh');
    await expect(map.getByRole('listitem').filter({ hasText: 'Bangsal Melati' })).not.toContainText(
      'Hampir penuh',
    );
    await noHorizontalOverflowAtTablet(page);
  });
});

/**
 * Pemicu panduan presentasi ("Simulasi · n dari m · tahap") ada di header lengket, bukan melayang di atas isi:
 * di laptop presentasi (1366×768) dan tablet, tombol/tautan halaman tidak pernah berada di bawahnya, termasuk
 * banner skenario, bilah kirim CPOE, stepper pendaftaran, dan kasir. Isi yang digulir lewat di bawah header
 * (tertutup header), bukan di bawah tombol yang melayang.
 */
test.describe('panduan presentasi tidak menutupi isi layar', () => {
  /** Tombol/tautan/isian di `main` yang tampak dan terkena kotak pemicu (dan memang bisa diklik di sana). */
  async function coveredControls(page: Page): Promise<string[]> {
    return page.evaluate(() => {
      const trigger = document.querySelector('[aria-label="Panduan simulasi"] > button');
      if (!trigger) return ['(pemicu panduan tidak ada)'];
      const t = trigger.getBoundingClientRect();
      const hits: string[] = [];
      const controls = document.querySelectorAll<HTMLElement>(
        'main a[href], main button, main input, main select, main textarea, main [role="button"], main [tabindex]',
      );
      for (const el of controls) {
        const r = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        if (!r.width || !r.height || style.visibility === 'hidden') continue;
        const x0 = Math.max(r.left, t.left);
        const x1 = Math.min(r.right, t.right);
        const y0 = Math.max(r.top, t.top);
        const y1 = Math.min(r.bottom, t.bottom);
        if (x0 >= x1 || y0 >= y1) continue;
        // Tumpang tindih hanya boleh bila kontrol itu tertutup header (digulir ke bawah header lengket).
        const top = document.elementFromPoint((x0 + x1) / 2, (y0 + y1) / 2);
        if (top && el.contains(top))
          hits.push(el.getAttribute('aria-label') ?? el.textContent?.trim() ?? el.tagName);
        else if (window.scrollY === 0)
          hits.push(`(di bawah header saat atas halaman) ${el.textContent?.trim()}`);
      }
      return hits;
    });
  }

  const SCREENS: ReadonlyArray<{ role: string; path: string; igdStage?: string }> = [
    { role: 'dokter', path: `/klinis/order/${ENCOUNTER_ID.hartono}`, igdStage: 'Asesmen dokter' },
    { role: 'dokter', path: `/klinis/order/${ENCOUNTER_ID.rohana}` },
    { role: 'perawat', path: '/klinis/igd' },
    { role: 'petugas_pendaftaran', path: '/pendaftaran' },
    { role: 'kasir', path: '/keuangan/kasir' },
  ];

  for (const { role, path, igdStage } of SCREENS) {
    test(`${path} (${role}${igdStage ? ` · ${igdStage}` : ''})`, async ({ page }, testInfo) => {
      const account = await createAccount({ roles: [role] });
      await loginAs(page, account, '/simulasi');
      if (igdStage) {
        await page.goto('/simulasi');
        await page.getByRole('tab', { name: 'IGD → rawat inap' }).click();
        await page.getByText('Lompat ke tahap', { exact: true }).click();
        await page.getByRole('button', { name: new RegExp(`^\\d+\\. ${igdStage}$`) }).click();
        await expect(page.getByText(new RegExp(`Langkah \\d+ dari \\d+ · ${igdStage}`))).toBeVisible();
      }
      // Laptop presentasi (temuan QA visual 1366×768); proyek tablet memakai 768×1024.
      if (testInfo.project.name === 'demo-desktop') await page.setViewportSize({ width: 1366, height: 768 });
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();

      const header = page.getByRole('banner');
      const trigger = page
        .getByRole('complementary', { name: 'Panduan simulasi' })
        .getByRole('button', { name: /^Simulasi · \d+ dari \d+ · / });
      await expect(trigger).toBeVisible();
      const box = await trigger.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);

      const maxY = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
      for (const y of [0, Math.round(maxY / 2), maxY]) {
        await page.evaluate((top) => window.scrollTo(0, top), y);
        // Header (berisi pemicu) tetap di atas layar saat digulir.
        const [h, t] = [await header.boundingBox(), await trigger.boundingBox()];
        if (!h || !t) throw new Error('kotak header/pemicu tidak terbaca');
        expect(Math.round(h.y), `header di atas layar pada scroll ${y}`).toBe(0);
        expect(t.y >= h.y && t.y + t.height <= h.y + h.height, 'pemicu di dalam header').toBe(true);
        expect(await coveredControls(page), `kontrol tertutup pemicu pada scroll ${y}`).toEqual([]);
      }

      // Bisa dijangkau keyboard; panel tertutup lagi dengan Escape dan fokus kembali ke pemicu.
      await page.evaluate(() => window.scrollTo(0, 0));
      await trigger.focus();
      await page.keyboard.press('Enter');
      const panel = page.locator('#panduan-simulasi');
      await expect(panel).toBeVisible();
      await expect(trigger).toHaveAttribute('aria-expanded', 'true');
      await page.keyboard.press('Escape');
      await expect(panel).toHaveCount(0);
      await expect(trigger).toBeFocused();
    });
  }
});
