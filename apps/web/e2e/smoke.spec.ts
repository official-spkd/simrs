import { expect, test } from '@playwright/test';
import { SCREENS } from '../src/lib/screens';
import { createAccount, loginAs } from './support/accounts';
import { CONSENT_ID, ENCOUNTER_ID } from '../src/lib/demo/fixtures/ids';

test.describe('smoke', () => {
  test('/masuk tampil tanpa login, berbahasa Indonesia, dengan header keamanan', async ({ page }) => {
    const res = await page.goto('/masuk');
    expect(res?.status()).toBe(200);
    await expect(page.locator('html')).toHaveAttribute('lang', 'id');
    await expect(page.getByRole('heading', { name: 'Masuk ke SIM RS' })).toBeVisible();
    const headers = res?.headers() ?? {};
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(headers['x-frame-options']).toBe('DENY');
  });

  test('/masuk tanpa galat konsol: favicon tersedia (bukan 404) dan dirujuk dari <head>', async ({
    page,
    request,
  }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/masuk');
    await expect(page.getByRole('heading', { name: 'Masuk ke SIM RS' })).toBeVisible();
    const href = await page.locator('link[rel="icon"]').first().getAttribute('href');
    expect(href).toMatch(/favicon\.ico/);
    const icon = await request.get(href ?? '/favicon.ico');
    expect(icon.status()).toBe(200);
    expect(icon.headers()['content-type']).toContain('image/');
    expect((await request.get('/favicon.ico')).status()).toBe(200);
    await page.waitForLoadState('networkidle');
    expect(errors).toEqual([]);
  });

  test('beranda: menu sesuai peran; menu yang belum dibangun tidak bisa diklik', async ({
    page,
    viewport,
  }) => {
    const account = await createAccount({ roles: ['perawat'] });
    await loginAs(page, account);
    await expect(page.getByRole('heading', { name: 'Beranda', level: 1 })).toBeVisible();
    // Di luar mode presentasi tidak ada lencana data fiktif (ADR-0023).
    await expect(page.getByText('Mode presentasi · data fiktif')).toHaveCount(0);
    if ((viewport?.width ?? 1280) < 768) return;
    const nav = page.getByRole('navigation', { name: 'Navigasi utama' });
    // Layar yang hanya ada di mode presentasi tampil redup; layar hibrida berizin (Laboratorium, fase 4 4.0c) tidak
    // tampil bagi perawat yang tidak memegang izinnya.
    const onkologi = nav.getByTitle('Onkologi · layar belum tersedia').first();
    await expect(onkologi).toHaveAttribute('aria-disabled', 'true');
    await expect(nav.getByRole('link', { name: 'Onkologi' })).toHaveCount(0);
    await expect(nav.getByText('Laboratorium', { exact: true })).toHaveCount(0);
    // Perawat tidak memegang izin kelola pengguna: menunya tidak tampil.
    await expect(nav.getByText('Pengguna & akses')).toHaveCount(0);
    await expect(nav.getByText('Perawat', { exact: true })).toHaveCount(1);
    await expect(nav.getByText('Semua unit', { exact: true })).toBeVisible();
  });

  test('layar hibrida di mode api: rute ada, dijaga izin sungguhan (tanpa izin → akses ditolak; anjungan/TV → pendaftaran perangkat)', async ({
    page,
  }) => {
    // Kasir tidak memegang izin layar front office maupun klinis mana pun (perawat kini memegang `schedule.read`).
    const account = await createAccount({ roles: ['kasir'] });
    await loginAs(page, account);
    const hybrid = SCREENS.filter((s) => s.permission);
    expect(hybrid.map((s) => s.id).sort()).toEqual([
      'antrean',
      'asesmen',
      'askep',
      'bank-darah',
      'bed',
      'consent',
      'cppt',
      'daftar',
      'depo',
      'diagnosis',
      'diagnostik',
      'edukasi',
      'farmasi',
      'gizi',
      'igd',
      'jadwal',
      'kelengkapan',
      'kendali',
      'kiosk',
      'konsul',
      'kritis',
      'lab',
      'mikro',
      'ok',
      'order',
      'paket',
      'poli',
      'rad',
      'ranap',
      'resume',
      'ringkasan',
      'worklist',
    ]);
    // Rute detail layar klinis ikut gerbang layarnya (bukan 404 seperti layar presentasi).
    const details = [
      { route: `/klinis/rawat-inap/${ENCOUNTER_ID.hartono}`, label: 'Rawat inap' },
      { route: `/klinis/resume/${ENCOUNTER_ID.hartono}`, label: 'Resume medis' },
      { route: `/tablet/persetujuan/${CONSENT_ID.hartono}`, label: 'Persetujuan tindakan' },
    ];
    for (const s of [...hybrid, ...details.map((d) => ({ ...d, id: d.route }))]) {
      const res = await page.goto(s.route);
      expect(res?.status(), s.route).toBe(200);
      if (s.id === 'kiosk' || s.id === 'antrean') {
        // Anjungan/TV dibuka perangkat terdaftar, bukan sesi staf (ADR-0027): tanpa cookie perangkat → pendaftaran.
        await expect(page).toHaveURL(/\/perangkat\/daftar/);
        await expect(page.getByRole('heading', { name: 'Daftarkan perangkat', level: 1 })).toBeVisible();
        continue;
      }
      await expect(page.getByRole('heading', { name: s.label, level: 1 })).toBeVisible();
      await expect(page.getByText('Akses ditolak')).toBeVisible();
      await expect(page.getByText('Mode presentasi · data fiktif')).toHaveCount(0);
    }
    // Menu mengikuti izin sungguhan: tanpa izin front office/klinis, menunya tidak tampil.
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Navigasi utama' });
    await expect(nav.getByText('Pendaftaran', { exact: true })).toHaveCount(0);
    await expect(nav.getByText('Rawat inap', { exact: true })).toHaveCount(0);
  });

  test('layar klinis hibrida di mode api: peran berizin melihat "Belum tersambung" atau layar api (W1/W5b)', async ({
    page,
  }) => {
    // Dokter memegang clinical.read/write, order.write, bed.read, consent.write (matriks bawaan 3.0a).
    const dokter = await createAccount({ roles: ['dokter'] });
    await loginAs(page, dokter);
    const clinical = SCREENS.filter((s) => s.phase === 3 && s.permission);
    expect(clinical.map((s) => s.id).sort()).toEqual([
      'asesmen',
      'askep',
      'bed',
      'consent',
      'cppt',
      'diagnosis',
      'edukasi',
      'igd',
      'kelengkapan',
      'konsul',
      'order',
      'paket',
      'poli',
      'ranap',
      'resume',
      'ringkasan',
      'worklist',
    ]);
    // Bagan RME yang tersambung API di 3.8 (Konsultasi, Edukasi, Paket layanan): alurnya di `konsultasi-api.spec.ts`
    // dan `persetujuan.spec.ts`; di sini cukup halaman api terbuka tanpa "Belum tersambung".
    for (const id of ['konsul', 'edukasi', 'paket']) {
      const screen = clinical.find((s) => s.id === id);
      expect((await page.goto(screen?.route ?? '/'))?.status(), id).toBe(200);
      await expect(page.getByText('Belum tersambung', { exact: true })).toHaveCount(0);
      await expect(page.getByText('Mode presentasi · data fiktif')).toHaveCount(0);
    }
    // Rawat inap sudah tersambung API (layar W4, `rawat-inap-api.spec.ts`): daftar terbuka, ID demo = tidak ditemukan.
    await page.goto('/klinis/rawat-inap');
    await expect(page.getByRole('heading', { name: 'Pasien rawat inap', level: 1 })).toBeVisible();
    await expect(page.getByText('Belum tersambung', { exact: true })).toHaveCount(0);
    const demoId = await page.goto(`/klinis/rawat-inap/${ENCOUNTER_ID.hartono}`);
    expect(demoId?.status()).toBe(200);
    await expect(page.getByText('Kunjungan tidak ditemukan')).toBeVisible();
    // IGD dan Tempat tidur sudah tersambung API (layar W3): halaman api terbuka tanpa "Belum tersambung".
    for (const [route, heading] of [
      ['/klinis/igd', 'Instalasi Gawat Darurat'],
      ['/klinis/tempat-tidur', 'Manajemen tempat tidur'],
    ] as const) {
      expect((await page.goto(route))?.status(), route).toBe(200);
      await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
      await expect(page.getByText('Belum tersambung', { exact: true })).toHaveCount(0);
    }
    // Edukasi, Konsultasi, dan Paket layanan tersambung API sejak 3.8 (A2): terbuka tanpa "Belum tersambung".
    for (const id of ['edukasi', 'konsul', 'paket']) {
      const s = clinical.find((x) => x.id === id);
      expect(s, id).toBeDefined();
      expect((await page.goto(s?.route ?? '/'))?.status(), id).toBe(200);
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      await expect(page.getByText('Belum tersambung', { exact: true })).toHaveCount(0);
      await expect(page.getByText('Akses ditolak')).toHaveCount(0);
    }
    // Layar lain yang sudah tersambung API (W2: CPOE, W5a: tablet persetujuan, W1: poli, W5b: resume, 3.8: edukasi,
    // konsultasi, paket layanan) diperiksa terpisah di bawah.
    const connected = new Set([
      'ranap',
      'order',
      'consent',
      'poli',
      'resume',
      'igd',
      'bed',
      'edukasi',
      'konsul',
      'paket',
      'asesmen',
      'askep',
      'cppt',
      'diagnosis',
      'kelengkapan',
      'ringkasan',
      'worklist',
    ]);
    const routes = [
      ...clinical.filter((s) => !connected.has(s.id)).map((s) => ({ route: s.route, label: s.label })),
    ];
    for (const r of routes) {
      const res = await page.goto(r.route);
      expect(res?.status(), r.route).toBe(200);
      await expect(page.getByRole('heading', { name: r.label, level: 1 })).toBeVisible();
      await expect(page.getByText('Belum tersambung', { exact: true })).toBeVisible();
      await expect(page.getByText('Akses ditolak')).toHaveCount(0);
      await expect(page.getByText('Mode presentasi · data fiktif')).toHaveCount(0);
    }
    // CPOE sudah tersambung (W2): daftar kunjungan dari worklist; id fixture presentasi bukan kunjungan sungguhan →
    // kunjungan tidak ditemukan.
    expect((await page.goto('/klinis/order'))?.status()).toBe(200);
    await expect(page.getByRole('heading', { name: 'Order & resep (CPOE)', level: 1 })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Kunjungan berjalan' })).toBeVisible();
    await expect(page.getByText('Belum tersambung', { exact: true })).toHaveCount(0);
    await page.goto(`/klinis/order/${ENCOUNTER_ID.suryo}`);
    await expect(page.getByRole('heading', { name: 'Order & resep (CPOE)', level: 1 })).toBeVisible();
    await expect(page.getByText('Kunjungan tidak ditemukan')).toBeVisible();
    // Tablet persetujuan sudah tersambung (W5a): pilih kunjungan; id fixture presentasi bukan draf sungguhan.
    expect((await page.goto('/tablet/persetujuan'))?.status()).toBe(200);
    await expect(page.getByRole('heading', { name: 'Pilih kunjungan pasien', level: 1 })).toBeVisible();
    await expect(page.getByText('Belum tersambung', { exact: true })).toHaveCount(0);
    await page.goto(`/tablet/persetujuan/${CONSENT_ID.hartono}`);
    await expect(page.getByRole('heading', { name: 'Persetujuan tindakan', level: 1 })).toBeVisible();
    await expect(page.getByText('Draf tidak ditemukan')).toBeVisible();

    // Konsultasi, Edukasi, Paket layanan sudah tersambung (3.7/3.8, `konsultasi-api.spec.ts`, `persetujuan.spec.ts`).
    await page.goto('/klinis/konsultasi');
    await expect(page.getByRole('heading', { name: 'Konsultasi & rawat bersama', level: 1 })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Konsul masuk' })).toBeVisible();
    await page.goto('/klinis/edukasi');
    await expect(page.getByRole('heading', { name: 'Edukasi pasien', level: 1 })).toBeVisible();
    await expect(page.getByText('Pilih kunjungan pasien')).toBeVisible();
    await page.goto('/klinis/paket-layanan');
    await expect(page.getByRole('heading', { name: 'Paket formulir per setting', level: 1 })).toBeVisible();
    await expect(page.getByText('Belum tersambung', { exact: true })).toHaveCount(0);

    // Tersambung API: dokter tanpa unit poli melihat antrean kosong; daftar resume kosong; id demo = tidak ditemukan.
    await page.goto('/klinis/poli');
    await expect(page.getByRole('heading', { name: 'Pemeriksaan pasien', level: 1 })).toBeVisible();
    await expect(page.getByText('Antrean kosong')).toBeVisible();
    await page.goto('/klinis/resume');
    await expect(page.getByRole('heading', { name: 'Resume medis', level: 1 })).toBeVisible();
    await expect(page.getByText('Belum ada pasien')).toBeVisible();
    expect((await page.goto(`/klinis/resume/${ENCOUNTER_ID.hartono}`))?.status()).toBe(200);
    await expect(page.getByText('Kunjungan tidak ditemukan')).toBeVisible();

    // Petugas pendaftaran (admisi IGD): papan IGD terbuka (`clinical.read`), Pemeriksaan poli tidak.
    await page.context().clearCookies();
    const admisi = await createAccount({ roles: ['petugas_pendaftaran'] });
    await loginAs(page, admisi);
    await page.goto('/klinis/igd');
    await expect(page.getByRole('heading', { name: 'Instalasi Gawat Darurat', level: 1 })).toBeVisible();
    await expect(page.getByText('Belum tersambung', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Akses ditolak')).toHaveCount(0);
    await page.goto('/klinis/poli');
    await expect(page.getByText('Akses ditolak')).toBeVisible();
  });

  test('layar mode presentasi tidak ada di luar mode demo (404)', async ({ page }) => {
    const account = await createAccount({ roles: ['perawat'] });
    await loginAs(page, account);
    const paths = SCREENS.filter((s) => s.status === 'demo' && !s.permission).map((s) => s.route);
    for (const path of paths) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBe(404);
    }
  });

  test.describe('/dev/ui (operator platform)', () => {
    test.beforeEach(async ({ page }) => {
      const operator = await createAccount({ tenant: 'PLATFORM', roles: ['superadmin_platform'] });
      await loginAs(page, operator, '/dev/ui');
    });

    test('gerbang alasan pembatalan bekerja', async ({ page }) => {
      await expect(page.getByRole('heading', { name: 'Pelangi Klinis', level: 1 })).toBeVisible();
      await page.getByRole('button', { name: 'Batalkan tindakan' }).click();
      const confirm = page.getByRole('button', { name: 'Ya, batalkan' });
      await expect(confirm).toBeDisabled();
      // Alasan terlalu pendek (< 5 karakter, mockup Fondasi): tombol tetap nonaktif dengan penjelasan.
      await page.getByLabel('Alasan pembatalan').fill('oke');
      await expect(confirm).toBeDisabled();
      await expect(page.getByText('Tulis alasan minimal 5 karakter.', { exact: false })).toBeVisible();
      await page.getByLabel('Alasan pembatalan').fill('Pasien menolak tindakan');
      await expect(confirm).toBeEnabled();
      await confirm.click();
      // Umpan balik berjam beserta alasannya (docs/08 §5.3).
      await expect(
        page
          .getByRole('status')
          .filter({ hasText: /Tindakan dibatalkan pukul \d{2}\.\d{2} · alasan: Pasien menolak tindakan/ }),
      ).toBeVisible();
    });

    test('validasi NIK menjelaskan cara memperbaiki', async ({ page }) => {
      const nik = page.getByLabel(/^NIK/);
      await nik.fill('12345');
      await expect(page.getByText('NIK harus 16 digit (sekarang 5).')).toBeVisible();
      await expect(nik).toHaveAttribute('aria-invalid', 'true');
      await nik.fill('9999010101900001');
      await expect(page.getByText('Format benar · siap dicek ke Dukcapil')).toBeVisible();
    });

    test('setiap kontrol interaktif galeri setinggi ≥ 44 px (target sentuh)', async ({ page }, testInfo) => {
      await expect(page.getByRole('heading', { name: 'Pelangi Klinis', level: 1 })).toBeVisible();
      // Tampilkan juga field dan tombol ringkas (sm) di formulir alasan pembatalan.
      await page.getByRole('button', { name: 'Batalkan tindakan' }).click();
      await expect(page.getByLabel('Alasan pembatalan')).toBeVisible();
      const { checked, extended, small } = await page.locator('main').evaluate((main) => {
        const out: string[] = [];
        let n = 0;
        let ext = 0;
        const sel = 'button, a[href], input, select, textarea, summary';
        for (const el of main.querySelectorAll<HTMLElement>(sel)) {
          if (el.offsetParent === null) continue;
          n += 1;
          el.scrollIntoView({ block: 'center' });
          const r = el.getBoundingClientRect();
          let h = r.height;
          if (h < 44) {
            // Segmen ringkas: area sentuh diperluas ::before; 3 px di atas/bawah tombol tetap mengenai tombol itu.
            const x = r.left + r.width / 2;
            const up = document.elementFromPoint(x, r.top - 3);
            const down = document.elementFromPoint(x, r.bottom + 3);
            if (up === el && down === el) {
              h = r.height + 8;
              ext += 1;
            }
          }
          if (h < 44)
            out.push(`${el.tagName} "${(el.textContent ?? '').trim().slice(0, 30)}" ${Math.round(h)} px`);
        }
        return { checked: n, extended: ext, small: out };
      });
      expect(small).toEqual([]);
      expect(checked).toBeGreaterThan(20);
      // Tiga pilihan Segmen memakai area sentuh yang diperluas (tampak 36 px).
      expect(extended).toBe(3);
      await page.screenshot({ path: testInfo.outputPath('dev-ui-kontrol.png'), fullPage: true });
    });

    test('tidak ada scroll horizontal', async ({ page }) => {
      for (const path of ['/', '/dev/ui', '/superadmin/panduan']) {
        await page.goto(path);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow, path).toBeLessThanOrEqual(0);
      }
    });
  });

  test('/masuk tanpa scroll horizontal', async ({ page }) => {
    await page.goto('/masuk');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
