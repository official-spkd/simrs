# Simulasi dan operasional

Halaman ini menjelaskan **mode presentasi** (layar dengan data dummy fiktif), layar **Simulasi pasien** yang menjalankan tiga skenario dari kedatangan sampai klaim, cara menyiapkan presentasi, dan **alat tangkap layar** yang membuat gambar di panduan ini.

> Status 6 Okt 2026: semua layar fase 2–10 terbuka di mode presentasi. Mode ini hanya hidup di mesin lokal (`APP_ENV=local` + `DATA_SOURCE=demo`, ADR-0023). Di staging dan produksi layar demo tidak ada (404).

## Ringkasan layar

| Layar                         | Rute           | Peran (mode presentasi) | Komponen        | Status |
| ----------------------------- | -------------- | ----------------------- | --------------- | ------ |
| Simulasi pasien               | `/simulasi`    | semua posisi            | semua (fase 10) | demo   |
| Masuk cepat · mode presentasi | `/masuk`       | 16 akun presentasi      | P02             | demo   |
| Ganti posisi                  | `/akun/posisi` | semua                   | P03             | api    |

## Mode presentasi

Mode presentasi dibuat agar klien dan direksi bisa melihat **seluruh alur RS** sebelum backend fase 4–9 selesai. Aturannya:

1. Layar dibangun di **rute finalnya**, dengan data dummy fiktif (`apps/web/src/lib/demo/fixtures/`). Saat backend jadi, layar yang sama berpindah ke data API (lihat [Peta kode](./19-peta-kode.md#web-satu-layar-dua-sumber-data)).
2. Header selalu menampilkan lencana **"Mode presentasi · data fiktif"**.
3. Setiap layar punya posisi pemakai (`demoRoles` di `apps/web/src/lib/screens.ts`). Posisi lain tidak melihat menunya; bila membuka rutenya, tampil ajakan **Ganti posisi**.
4. Aksi di layar demo (simpan, validasi, kirim) hanya mengubah tampilan dan keadaan simulasi, dan ditandai "(simulasi, tidak disimpan)". Server Action demo menolak berjalan di luar mode ini (`assertDemo()`).
5. Jam demo tetap: **Sen, 5 Okt 2026 · 10.45** (skenario IGD memakai jamnya sendiri). Tempat setiap pasien fiktif pada jam itu diatur satu kali di `apps/web/src/lib/demo/fixtures/pasien.ts`.

### Menjalankan

| Perintah                               | Kapan                                                                         |
| -------------------------------------- | ----------------------------------------------------------------------------- |
| `pnpm with-pg pnpm db:akun-presentasi` | Sekali (atau bila kredensial perlu diganti): 16 akun fiktif per posisi        |
| `pnpm demo`                            | Presentasi: build produksi lalu jalankan semua layanan (tanpa jeda kompilasi) |
| `pnpm demo --tanpa-build`              | Sama, memakai build terakhir                                                  |
| `pnpm dev:demo`                        | Latihan atau pengembangan layar demo (mode dev, ada jeda kompilasi)           |
| `pnpm demo:cek`                        | Daftar periksa sebelum tampil; semua butir harus ✓                            |

Naskah presentasi (versi direksi ±20 menit dan versi tim RS ±45 menit) ada di `docs/presentasi/naskah.md`.

### Akun presentasi

Di layar `/masuk` mode presentasi muncul kartu **"Masuk cepat · mode presentasi"**, dikelompokkan per bagian (front office, klinis, penunjang, keuangan dan rekam medis, manajemen dan sistem). Satu klik menjalankan login biasa (sandi + kode verifikasi) di server dengan kredensial lokal `.local/demo-accounts.json`. Kredensial tidak pernah dikirim ke browser.

Semua akun presentasi satu RS **berbagi satu keadaan simulasi**, jadi presenter bisa berganti posisi di tengah skenario tanpa kehilangan langkah. Akun uji E2E memakai berkas dan folder keadaan sendiri (`DEMO_ACCOUNTS_FILE`, `DEMO_STATE_DIR`).

## Simulasi pasien

![Layar Simulasi pasien: tab tiga skenario, kartu pasien Tn. Suryo, lini tahap, tugas berikutnya, rekam medis yang terbentuk, integrasi BPJS, dan tagihan berjalan](./gambar/simulasi.png)

| Hal      | Isi                                                                                                                                                 |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rute     | `/simulasi`                                                                                                                                         |
| Pemakai  | semua posisi (`demoRoles: 'semua'`)                                                                                                                 |
| Komponen | semua lapisan (fase 10, uji end-to-end)                                                                                                             |
| Status   | demo (mode presentasi)                                                                                                                              |
| Mockup   | `design/mockups/Simulasi.dc.html`                                                                                                                   |
| Kode web | `apps/web/src/app/(staf)/simulasi/` · `apps/web/src/lib/demo/engine/` · `apps/web/src/lib/demo/skenario/` · `apps/web/src/lib/server/demo/store.ts` |
| Kode API | tidak ada (keadaan simulasi disimpan web, hanya urutan aksi)                                                                                        |

**Tujuan.** Menunjukkan perjalanan satu pasien melewati semua layar dalam satu cerita, lengkap dengan rekam medis yang terbentuk, pesan ke BPJS/SATUSEHAT, tagihan berjalan, dan jejak sistem.

**Tiga skenario.**

| Skenario             | Pasien fiktif         | Tahap                                                                                                                                                   |
| -------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rawat jalan BPJS     | Tn. Suryo Adi Nugroho | check-in anjungan → SEP → asesmen perawat → pemeriksaan + order → lab → resep + CDS → farmasi → tagihan → setelah pulang (9 tahap)                      |
| IGD → rawat inap     | Tn. Hartono Wibisono  | datang nyeri dada → triase → EKG + order set → nilai kritis → tata laksana → tempat tidur + SEP ranap → perawatan → resume → tagihan → klaim (10 tahap) |
| Elektif · TPDI × BTN | Ny. Ratna Sari        | admisi elektif → deposit lewat BTN → laparoskopi → pasca operasi → resume → pelunasan → rekonsiliasi 3 arah → klaim → pembiayaan piutang (9 tahap)      |

![Skenario IGD → rawat inap pada tahap Triase: tugas triase dengan saran sistem dan pilihan level](./gambar/simulasi--igd.png)

**Alur.**

1. Pilih tab skenario. Kartu pasien, lini tahap, dan jam simulasi tampil.
2. Kerjakan tugas berurutan: **aksi** (tombol), **pilihan** (mis. pengenalan wajah atau sidik jari), atau **isian** (mis. tekanan darah). Tugas berikutnya terkunci sampai tugas sebelumnya selesai.
3. Setiap tugas memajukan jam simulasi dan menambah baris di rekam medis, integrasi (task ID BPJS, SATUSEHAT), tagihan, dan jejak sistem.
4. Panel panduan (pil hijau di kanan bawah, juga di layar lain) menunjukkan langkah aktif dan bisa membuka layar posisi yang tepat dengan berganti akun.
5. **Lompat ke tahap** mengerjakan tugas sebelumnya dengan pilihan bawaan; **Putar otomatis** menjalankan skenario sendiri; **Mulai ulang** mengosongkan skenario.
6. Di tahap terakhir, **Selesaikan simulasi** menampilkan ringkasan: lama layanan, waktu tunggu per tahap, dan total tarif tertangkap otomatis.

![Ringkasan simulasi rawat jalan setelah selesai: total tarif Rp 806.000, pasien bayar Rp 0, waktu per tahap](./gambar/simulasi--ringkasan.png)

**Gerbang keselamatan dan aturan bisnis.**

- Gerbang merah di tugas skenario sama dengan di layar asli: CDS resep (riwayat hipoglikemia berat pada sulfonilurea), triase di bawah saran sistem wajib alasan minimal 10 karakter, nilai kritis wajib read-back.
- Isian divalidasi server (mis. format tekanan darah sistolik/diastolik); isian bebas dibatasi 120 karakter (`MAX_INPUT_LENGTH`).
- Aksi dari tab yang sudah basi ditolak (nomor revisi keadaan), sehingga dua perangkat tidak saling menimpa.
- Mesin skenario murni: keadaan = urutan aksi yang diputar ulang dari awal (`runScenario`), jadi tampilan selalu sama untuk urutan yang sama. Definisi skenario berversi (`SCENARIO_DEF_VERSION`); keadaan lama dengan versi lain dimulai ulang.

**Mode api.** Tidak ada. `/simulasi` hanya untuk lingkungan non-produksi (docs/08 §4). Rencana fase 10 menambah simulasi end-to-end lewat API (`docs/rencana/fase-10-simulasi-ketahanan-pilot.md`).

## Tangkap layar dokumentasi

Semua gambar `.png` di `docs/panduan/gambar/` dibuat otomatis oleh Playwright, bukan disunting tangan. Diagram `diagram-*.svg` ditulis tangan (teks dan warna mengikuti token Klinis Bersih, terbaca di tema terang dan gelap).

### Menjalankan ulang

```bash
pnpm docs:gambar                                   # semua layar (mode presentasi + mode api)
pnpm docs:gambar -- --project=docs                 # mode presentasi saja
pnpm docs:gambar -- --project=docs-api             # layar tersambung API saja
pnpm docs:gambar -- --project=docs --grep kasir    # sebagian layar
pnpm with-pg pnpm docs:gambar                      # tanpa Docker (Postgres portabel)
```

Di salinan repo (git worktree) pakai slot E2E sendiri, misalnya:

```bash
E2E_API_PORT=4080 E2E_WEB_PORT=3080 E2E_DEMO_PORT=3081 E2E_MOCK_PORT=4180 E2E_TMP_NAME=simrs-demo-e2e-docs \
  pnpm docs:gambar
```

Perintah ini menyalakan stack E2E sendiri (mock, API, worker, build web mode api + mode presentasi) di database tes, persis seperti `pnpm --filter @simrs/web test:e2e`. Selesai menangkap, skrip mencetak jumlah gambar, total ukuran, dan gambar di atas 300 KB. Periksa `git diff --stat docs/panduan/gambar` sebelum commit.

### Cara kerjanya

| Berkas                                        | Isi                                                                                                      |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `scripts/docs-gambar.mjs`                     | Skrip root: `DOCS_CAPTURE=1` + proyek Playwright `docs` dan `docs-api`, lalu ringkasan ukuran            |
| `apps/web/e2e/docs/capture.ts`                | `openAs` (akun uji baru per peran, nama persona fiktif), `shoot` (1366×768, animasi mati), `watchErrors` |
| `apps/web/e2e/docs/tangkap-layar.spec.ts`     | Mode presentasi: satu gambar per layar `demo` di `SCREENS` + langkah kunci alur                          |
| `apps/web/e2e/docs/tangkap-layar-api.spec.ts` | Mode api: masuk, akses, audit, MPI, formulir, notifikasi, PIN, kendali antrean, panduan                  |
| `apps/web/playwright.config.ts`               | Proyek `docs` (server mode presentasi) dan `docs-api` (server mode api), viewport 1366×768               |

Aturan:

- Tanpa `DOCS_CAPTURE=1` spesifikasi di `e2e/docs/` dilewati, dan proyek E2E lain mengabaikan folder itu. `pnpm test:e2e` biasa tidak menimpa gambar.
- **Layar baru di registri tertangkap otomatis** sebagai `<id>.png` dengan posisi pemakai pertama di `demoRoles` ('semua' → dokter). Rute contoh untuk layar tanpa indeks bermakna ada di `MAIN_PATH`.
- Langkah kunci (gerbang CDS, read-back nilai kritis, gelang eMAR, time out kamar operasi, item manual kasir, SEP, tiket anjungan, DLQ, simulasi) ditulis sebagai tes terpisah bernama `<id>--<langkah>.png`. Satu langkah yang gagal tidak menghentikan tangkapan lain.
- Setiap tangkapan memeriksa status HTTP 200, tanpa galat JavaScript, dan tanpa ajakan "ganti posisi". Gambar dari layar rusak tidak tersimpan diam-diam.
- Nama berkas hanya huruf kecil, angka, dan `-` (pola sama dengan penyaji panduan). Ukuran sasaran ≤ 300 KB per gambar; tes unit menolak PNG > 400 KB.

### Menambah gambar ke panduan

1. Tambahkan tes langkah di `tangkap-layar.spec.ts` (atau biarkan otomatis untuk layar baru), lalu jalankan `pnpm docs:gambar -- --grep <nama>`.
2. Rujuk di Markdown dengan path relatif: `![Teks alt yang menjelaskan isi gambar](./gambar/<nama>.png)`. Path ini terbaca di GitHub maupun di `/superadmin/panduan`.
3. Teks alt **wajib** dan deskriptif (apa yang terlihat). Gambar tanpa alt, gambar luar, atau path di luar `gambar/` tidak dirender; yang tampil hanya keterangan penolakan.
4. `pnpm --filter @simrs/web test` memeriksa setiap gambar yang dirujuk ada, ber-alt, dan setiap SVG bebas skrip serta punya `<title>` dan gaya mode gelap.

### Cara gambar disajikan di web

- Penyaji Markdown (`apps/web/src/components/markdown.tsx`) mengubah `./gambar/<nama>` menjadi rute `/superadmin/panduan/gambar/<nama>` (`rewriteGuideImageSrc` di `apps/web/src/lib/guide.ts`). HTML mentah di Markdown tetap tidak dirender.
- Rute `apps/web/src/app/(staf)/superadmin/panduan/gambar/[file]/route.ts` memakai gerbang yang sama dengan halaman panduan (hanya operator platform; selain itu 404), mencocokkan nama dengan pola ketat sebelum menyentuh disk (tanpa path traversal, tanpa symlink), dan mengirim `Content-Type` yang benar, `X-Content-Type-Options: nosniff`, serta CSP `sandbox` tanpa skrip.
- SVG selalu dipakai sebagai `<img>`, tidak disisipkan inline, sehingga skrip di dalamnya tidak pernah jalan. Gambar dimuat dari origin sendiri, patuh CSP `img-src 'self'`.

## QA visual sebelum presentasi

`QA_VISUAL=1 pnpm --filter @simrs/web test:e2e` menyimpan tangkapan semua layar demo di 1366×768, 1920×1080, dan ukuran tablet ke `.local/qa-visual/` (tidak masuk repo), ditambah layar fase 2 mode api (`e2e/qa-visual-fase2.spec.ts`). Berbeda dengan `pnpm docs:gambar`, tangkapan ini halaman penuh untuk tinjauan tata letak, bukan untuk dokumentasi.

## Tes yang menjaga layar ini

- `apps/web/e2e/demo/simulasi.spec.ts`: tugas berurutan, jam berjalan, lompat ke akhir, ringkasan; gerbang triase IGD; panel panduan di layar lain.
- `apps/web/e2e/demo/akun-presentasi.spec.ts`: masuk cepat per posisi, panduan berganti akun, keadaan simulasi bersama.
- `apps/web/e2e/demo/semua-layar.spec.ts`: jaring pengaman semua layar demo (tanpa galat, tanpa scroll horizontal).
- `apps/web/src/lib/demo/engine/run.test.ts`, `apps/web/src/lib/demo/skenario/skenario.test.ts`, `apps/web/src/lib/server/demo/store.test.ts`.
- `apps/web/src/lib/guide.test.ts`, `apps/web/src/components/markdown.test.tsx`, `apps/web/e2e/panduan.spec.ts`: penyajian panduan dan gambar.

## Lihat juga

- [Peta kode](./19-peta-kode.md): struktur demo vs api dan pola menambah layar.
- [Fitur front office](./11-fitur-front-office.md), [Fitur klinis](./12-fitur-klinis.md), [Fitur keuangan](./14-fitur-keuangan.md): layar yang dilewati skenario.
- [Cara kode bekerja](./02-cara-kerja-kode.md#mode-presentasi-dan-data-dummy-adr-0023): mekanisme mode presentasi.
- `docs/adr/0023-mode-presentasi-ui-dulu-dengan-data-dummy.md`, `docs/presentasi/naskah.md`.
