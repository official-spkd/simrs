# 13 · Pembagian tugas Claude Code (CD) dan Codex (CX)

Papan tugas kerja simultan. Aturan koordinasi umum ada di `docs/12-codex-claude.md`; dokumen ini menetapkan **siapa mengerjakan apa, urutannya, dan batas berkasnya**. Status fase tetap di `docs/PROGRESS.md`. Checkpoint tiap tugas ada di `docs/handoff/<ID>.md`; salin `docs/handoff/TEMPLATE.md` saat mulai.

- **CD-n** dikerjakan Claude Code.
- **CX-n** dikerjakan Codex.

> **Keputusan pemilik produk 6 Okt 2026 (revisi):** backend **ditunda**. Kedua alat fokus ke **front end mode presentasi yang sudah interaktif**. Tugas backend lama dipindah ke §9 (backlog, belum dijadwalkan).

## 1. Arti "interaktif"

Layar demo dianggap interaktif bila memenuhi lima syarat. Kelimanya menjadi kriteria selesai setiap tugas.

1. **Bertahan.** Setiap aksi di layar disimpan di server (per RS demo) dan masih ada setelah halaman dimuat ulang, setelah berganti posisi, dan di perangkat lain. Label "(simulasi, tidak disimpan)" hilang.
2. **Mengalir.** Hasil aksi muncul di layar terkait. Contoh:
   - order CPOE → worklist Lab/Radiologi/Farmasi + charge capture;
   - hasil lab → ringkasan pasien + worklist dokter;
   - pemberian eMAR → tagihan;
   - kasir lunas → jurnal Akuntansi + klaim.
3. **Tanpa tombol mati.** Setiap tombol punya efek yang terlihat. Bila sengaja nonaktif, alasannya tertulis.
4. **Gerbang tetap.** Gerbang keselamatan dan pemisahan tugas memakai pengguna sesi (atau "Bertindak sebagai" pada Superadmin demo), bukan nama dari dropdown. Override wajib alasan.
5. **Bisa diulang.** Ada tombol "Mulai ulang data demo" per RS yang mengembalikan semua layar ke keadaan awal fixture.

Batas yang tetap berlaku (ADR-0023):
- hanya `APP_ENV=local` dan `DATA_SOURCE=demo`;
- setiap Server Action memanggil `assertDemo()`;
- data fiktif, uang `bigint`;
- tanpa API backend baru, tanpa migrasi, tanpa dependensi baru.

## 2. Kepemilikan berkas

Semua tugas bekerja di `apps/web`. Kepemilikan dibagi **per domain**, agar dua alat tidak menyunting berkas yang sama:

| Domain (rute · komponen · `lib` · fixture)                                                                                                                                                         | Pemilik |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| **Inti toko demo**: `src/lib/demo/store/**`, `src/lib/server/demo/**`, `src/components/demo-*.tsx`                                                                                                  | **CD-1** (setelah selesai: CD-0) |
| **Klinis**: `app/(staf)/klinis/**`, `app/(perangkat)/tablet/**`, `components/{klinis,rawat-inap,rme,onkologi}/**`, `lib/{klinis*,rawat-inap*,rme*,onkologi*}.ts`, fixture terkait                    | **CD-2** |
| **Front office + platform**: `app/(staf)/{pendaftaran,jadwal,antrean,rujukan,rekam-medis,sistem}/**`, `app/(perangkat)/{kiosk,display,pratinjau/info-publik}/**`, `components/{front-office,platform,rujukan,info-publik,operasional}/**`, `lib/{front-office*,platform-*,rujukan,info-publik,operasional-*,golive,mpi,akses,audit,forms}*.ts` | **CD-3** |
| **Penunjang + integrasi**: `app/(staf)/penunjang/**`, `app/(staf)/sistem/integrasi/**`, `components/{penunjang,integrasi}/**`, `lib/{penunjang*,integrasi-*}.ts`                                   | **CX-1** |
| **Keuangan + pembayaran BTN**: `app/(staf)/keuangan/**`, `components/{keuangan,btn}/**`, `lib/{keuangan*,btn*}.ts`                                                                                   | **CX-2** |
| **Back office + manajemen + aplikasi**: `app/(staf)/manajemen/**`, `app/(perangkat)/pratinjau/aplikasi-*/**`, `components/{manajemen,backoffice,sdm,ppi,penggajian,rekam-medis-adm,…}/**`, `lib/{manajemen*,dasbor,sdm,backoffice*}.ts` | **CX-3** |
| `src/lib/screens.ts`, `nav.ts`, `demo/personas.ts`, `staff-sidebar.tsx`, `playwright.config.ts`                                                                                                       | **CD-0** (tugas lain: permintaan lewat handoff) |
| `docs/panduan/**`, `docs/PROGRESS.md`, `docs/adr/README.md`, dokumen ini                                                                                                                              | **CD-0** |
| `apps/api`, `apps/worker`, `packages/db`, `packages/shared`, `package.json`, `pnpm-lock.yaml`                                                                                                         | **tidak ada** (ditunda; butuh izin pemilik produk) |
| `CLAUDE.md`, `AGENTS.md`, `design/**`, `docs/03-regulasi-mrmik.md`                                                                                                                                    | **pemilik produk** |

Fixture bersama (`src/lib/demo/fixtures/{pasien,rs,staf,ids,waktu}.ts`) hanya boleh **ditambah**, tidak diubah, kecuali oleh CD-0.

Nomor ADR: **CD 0085–0089**, **CX 0090–0094** (0077 sudah dipakai Codex untuk 3.5).

## 3. Integrasi ke `master` (satu pintu)

1. Setiap tugas bekerja di worktree dan branch sendiri:
   - CD: `.claude/worktrees/<…>`, branch `cd/<id>`.
   - CX: `~/.codex/worktrees/<id>/simrs`, branch `codex/<id>`.
2. Sebelum selesai, tugas menggabungkan `master` terbaru ke branch-nya lalu menjalankan gerbang:
   - `pnpm lint && pnpm typecheck && pnpm --filter @simrs/web test`;
   - E2E demo domainnya + `e2e/demo/semua-layar.spec.ts` di slot-nya (§4).
3. Setelah hijau, tulis status **"siap integrasi"** di handoff, lengkap dengan commit terakhir dan bukti tes.
4. **Hanya CD-0 (Claude Code)** yang menggabungkan ke `master` di checkout utama, menjalankan gerbang penuh + E2E, push, dan memperbarui `docs/PROGRESS.md`. Tugas lain tidak meng-commit di checkout utama.
5. Bila CD-0 tidak tersedia, pemilik produk boleh menunjuk Codex sebagai integrator sementara; catat di handoff `CD-0`.

## 4. Sumber daya terpisah

| Pemakai                      | Database tes          | Port E2E (API / web / demo / mock) | `E2E_TMP_NAME`       |
| ---------------------------- | --------------------- | ---------------------------------- | -------------------- |
| CD-0 integrator              | `simrs_test`          | 4010 / 3010 / 3011 / 4110 (bawaan) | `simrs-demo-e2e`     |
| Dev server pemilik produk    | `simrs`               | 4000 / 3000 / — / 4100             | —                    |
| CD-1, CD-2                   | `simrs_test_cd_a`     | 4020 / 3020 / 3021 / 4120          | `simrs-demo-e2e-cda` |
| CD-3, CD-4                   | `simrs_test_cd_b`     | 4030 / 3030 / 3031 / 4130          | `simrs-demo-e2e-cdb` |
| CX-0, CX-1, CX-4             | `simrs_test_codex_a`  | 4510 / 3510 / 3511 / 4610          | `simrs-demo-e2e-cxa` |
| CX-2                         | `simrs_test_codex_b`  | 4520 / 3520 / 3521 / 4620          | `simrs-demo-e2e-cxb` |
| CX-3                         | `simrs_test_codex_c`  | 4530 / 3530 / 3531 / 4630          | `simrs-demo-e2e-cxc` |

- Postgres Docker ada di 127.0.0.1:5433. Buat database dengan `docker compose exec postgres psql -U postgres -c "CREATE DATABASE simrs_test_<nama> OWNER simrs_migrator"`.
- Jangan pernah membuat ulang atau menghapus database tanpa izin.
- Folder data toko demo E2E memakai `E2E_TMP_NAME`, jadi terpisah per slot.

## 5. Gelombang kerja

| Gelombang | Claude Code                                         | Codex                                               |
| --------- | --------------------------------------------------- | --------------------------------------------------- |
| 0         | **CD-1** Inti toko demo bersama (wajib lebih dulu)  | **CX-0** Audit tombol mati + peta aliran antarlayar (baca saja) |
| 1         | **CD-2** Klinis interaktif                          | **CX-1** Penunjang + integrasi interaktif           |
| 1         | **CD-3** Front office + platform interaktif         | **CX-2** Keuangan + BTN interaktif                  |
| 1         | —                                                   | **CX-3** Back office + manajemen + aplikasi interaktif |
| 2         | **CD-4** Perjalanan pasien lintas layar (E2E) + Superadmin | **CX-4** Konsistensi data antarlayar + QA aksesibilitas |
| 3         | **CD-5** Panduan bergambar + QA visual + PROGRESS   | —                                                   |
| terus     | **CD-0** Integrator                                 | —                                                   |

- Gelombang 0 berjalan bersamaan. CX-0 hanya membaca dan menghasilkan daftar kerja untuk gelombang 1.
- Gelombang 1 baru mulai setelah CD-1 digabung ke `master`, karena semua domain memakai toko yang sama.
- CX-1, CX-2, dan CX-3 boleh berjalan bersamaan bila pemilik produk membuka tiga sesi Codex dengan worktree dan slot terpisah. Bila hanya satu sesi, kerjakan berurutan: CX-1, lalu CX-2, lalu CX-3.

## 6. Rincian tugas Claude Code (CD)

### CD-0 · Integrator (berjalan terus)

Langkah per tugas yang "siap integrasi":

1. Tinjau handoff dan diff.
2. `git merge --no-ff` ke `master`.
3. Jalankan gerbang penuh: `pnpm build && pnpm lint && pnpm typecheck && pnpm test`, lalu `pnpm --filter @simrs/web test:e2e`.
4. Push.
5. Perbarui `docs/PROGRESS.md`.

CD-0 juga memegang berkas registri (`screens.ts`, `nav.ts`, personas, sidebar). Perubahan registri yang dibutuhkan tugas lain ditulis di handoff mereka, lalu CD-0 yang menerapkannya.

### CD-1 · Inti toko demo bersama (gelombang 0)

- **Tujuan:** satu penyimpanan keadaan demo di server, per RS demo, yang dipakai semua layar. Aksi layar mana pun bertahan dan bisa dibaca layar lain.
- **Berkas:** `src/lib/demo/store/**` (baru), `src/lib/server/demo/**`, `src/components/demo-*.tsx`. ADR CD-0085 ("toko keadaan demo bersama").
- **Isi:**
  1. Pola **log kejadian + reducer murni per domain**, mirip mesin skenario `lib/demo/engine`:
     - keadaan = fixture awal + kejadian berurutan;
     - disimpan sebagai berkas JSON lokal per RS, dengan penulisan atomik seperti `lib/server/demo/store.ts`;
     - punya `rev` untuk menolak aksi dari tampilan basi;
     - ukuran dibatasi.
  2. API tipe-aman:
     - `defineDomain(name, { initial, reduce, eventSchema })`;
     - `readDomain(name)` di server component;
     - `dispatch(name, event)` lewat Server Action generik yang memanggil `assertDemo()`, memvalidasi zod, dan mencatat pelaku dari sesi;
     - `revalidatePath` untuk layar terkait.
  3. Kejadian lintas domain lewat **langganan reducer**. Contoh: kejadian `klinis/order.submitted` dibaca reducer `penunjang` dan `keuangan`, tanpa impor silang komponen.
  4. Tombol **"Mulai ulang data demo"** (posisi admin/manajemen/Superadmin demo) beserta konfirmasinya.
  5. Integrasi dengan skenario Simulasi: tetap terpisah, tetapi dokumentasikan mana yang dipakai layar.
  6. **Contoh migrasi satu alur kecil** sebagai acuan pola bagi semua domain, mis. "Catat pelaporan nilai kritis" di Lab → muncul di Pusat hasil kritis.
  7. Panduan pola di `docs/panduan/19-peta-kode.md`: cara menambah domain, kejadian, dan aliran.
- **Selesai bila:**
  - tes unit reducer dan toko (atomik, `rev` basi ditolak, ukuran, reset);
  - E2E: aksi contoh → muat ulang → masih ada → layar kedua menampilkan hasilnya → reset → kembali awal;
  - aman: di mode api toko tidak dibaca, dan Server Action menolak.

### CD-2 · Klinis interaktif (gelombang 1)

- **Layar:** Poli, CPOE, IGD, Tempat tidur, Rawat inap (CPPT, eMAR, observasi, askep), Resume, Persetujuan tablet, Worklist, CPPT, Asesmen, Diagnosis, Konsultasi, Edukasi, Asuhan keperawatan, Ringkasan, Paket layanan, Kelengkapan, Onkologi.
- **Aliran keluar** (kejadian yang diterbitkan):
  - order lab, radiologi, dan resep → worklist penunjang/farmasi + charge capture;
  - triase dan admisi → papan bed + command center;
  - pemberian eMAR → tagihan;
  - resume final → klaim + kelengkapan RM;
  - consent final → OK dan kelengkapan.
- **Aliran masuk:**
  - hasil lab/radiologi dan nilai kritis → ringkasan, worklist dokter, rawat inap;
  - obat diserahkan farmasi → eMAR.
- **Gerbang:**
  - co-sign hanya DPJP, dengan identitas dari sesi;
  - gelang eMAR;
  - CDS;
  - triase turun beralasan;
  - tutup kunjungan butuh kelengkapan.
- **Selesai bila:** tidak ada lagi label "tidak disimpan" di domain klinis, dan E2E demo per layar membuktikan bertahan + mengalir.

### CD-3 · Front office + platform interaktif (gelombang 1)

- **Layar:** Pendaftaran, Jadwal, Anjungan, Display antrean, Kendali antrean (demo), Rujukan, Info publik, Struktur RS, Pengaturan, Terminologi, Dokumen, Penjadwal, Downtime, Cadangan, Go-live. Akses, Audit, MPI, dan Formulir hanya jalur demonya.
- **Aliran:**
  - booking/anjungan → antrean → display TV → panggil → kunjungan di Poli/IGD (CD-2) + charge pendaftaran;
  - pengaturan modul aktif → menu tersembunyi (lewat CD-0);
  - downtime aktif → banner di semua layar + antrean sinkron.
- **Selesai bila:** sama dengan CD-2 untuk domainnya, ditambah E2E anjungan → display tanpa muat ulang.

### CD-4 · Perjalanan pasien lintas layar + Superadmin (gelombang 2)

- **Isi:** tiga E2E perjalanan dengan akun Superadmin demo, tanpa skenario Simulasi:
  - **Rawat jalan BPJS:** anjungan → pendaftaran → poli → CPOE → lab → farmasi → kasir → klaim → jurnal.
  - **IGD → rawat inap:** triase → bed → eMAR → resume → pulang → bed kotor → tagihan.
  - **Elektif TPDI × BTN:** booking → consent → OK → pembayaran VA → rekonsiliasi.
- **Pemeriksaan per langkah:** angka dan status di layar berikutnya sama dengan yang dihasilkan layar sebelumnya.
- **Juga:** pemilih "Bertindak sebagai" diuji di gerbang pemisahan tugas.

### CD-5 · Panduan bergambar + QA visual (gelombang 3)

- **Isi:**
  1. Jalankan `pnpm docs:gambar` dan `QA_VISUAL=1`.
  2. Perbarui `docs/panduan/10`–`20`: alur kini interaktif dan aliran antarlayar digambar sebagai diagram SVG baru `diagram-aliran-demo.svg`.
  3. Perbarui PROGRESS.

## 7. Rincian tugas Codex (CX)

### CX-0 · Audit tombol mati + peta aliran antarlayar (gelombang 0, baca saja)

- **Tujuan:** daftar kerja konkret untuk CX-1..3 dan CD-2..3 sebelum toko demo selesai.
- **Isi:** telusuri ke-80 layar di `src/lib/screens.ts`. Bisa memakai E2E sementara (tidak di-commit) yang mengeklik setiap tombol. Catat:
  - (a) tombol tanpa efek atau nonaktif tanpa alasan;
  - (b) aksi yang hanya keadaan klien (`useState` + label "tidak disimpan");
  - (c) data yang seharusnya mengalir ke layar lain (sumber → tujuan → field);
  - (d) data yang saling bertentangan antarlayar (lanjutan temuan bug 6 Okt di PROGRESS: INV-02203/02209, koding Yusuf/Aminah/Joko, kode Endang, stok PCT2512, dll.).
- **Hasil:** `docs/handoff/CX-0.md`, berupa tabel per domain dengan pemilik tugas (CD-2/CD-3/CX-1/CX-2/CX-3). Tidak ada perubahan kode.

### CX-1 · Penunjang + integrasi interaktif (gelombang 1)

- **Layar:**
  - Penunjang: Lab, Radiologi, Farmasi, Depo, Bank darah, Gizi, Mikrobiologi/PA, Diagnostik, Kamar operasi + anestesi, Hasil kritis.
  - Integrasi: hub, SATUSEHAT, BPJS, Kemenkes, Device gateway, API publik.
- **Aliran masuk:** order dari CPOE (CD-2); consent final → OK; diet order DPJP → gizi.
- **Aliran keluar:**
  - hasil tervalidasi dan nilai kritis → klinis;
  - dispensing → eMAR + stok depo + charge;
  - tindakan OK → charge + resume;
  - pesan integrasi (`held`/terkirim/DLQ) dari kejadian domain lain.
- **Gerbang** memakai pengguna sesi: read-back, cek ganda darah oleh dua petugas berbeda, high-alert pemeriksa kedua, FEFO, urutan WHO checklist.
- **Utang bug 6 Okt yang diselesaikan:**
  - kantong kedua permintaan multi-kantong;
  - Server Action tidak lagi mempercayai boolean klien;
  - TTE atas nama pengguna;
  - "diteruskan ke Pusat hasil kritis" kini benar-benar diteruskan.
- **Selesai bila:** tidak ada label "tidak disimpan" di domainnya, dan E2E bertahan + mengalir.

### CX-2 · Keuangan + BTN interaktif (gelombang 1)

- **Layar:** Kasir, Klaim, Koding, Akuntansi, Tarif, Charge capture, Piutang, Jasa pelayanan, Kas & bank, Hutang, Costing, Pembayaran BTN, Pembiayaan BTN.
- **Aliran masuk:** charge dari klinis/penunjang/front office; PO diterima dari Logistik (CX-3).
- **Aliran keluar:**
  - kasir lunas → jurnal + piutang + klaim;
  - klaim final → piutang BPJS → pembiayaan;
  - pembayaran VA/QRIS → rekonsiliasi 3 arah.
- **Aturan:**
  - setiap mutasi uang menghasilkan jurnal seimbang (tes properti);
  - pembuat ≠ penyetuju diambil dari sesi;
  - periode tertutup terkunci.
  - Tutup periode dengan jurnal yang menunggu persetujuan mengikuti keputusan K-2 (§8).
- **Utang bug 6 Okt:** kode akun penggajian bentrok jaspel (koordinasi dengan CX-3); INV-02203/02209 konsisten dengan Kasir/BTN.

### CX-3 · Back office + manajemen + aplikasi interaktif (gelombang 1)

- **Layar:** Logistik, Mutu, Dasbor, Command center, RM administratif, SDM, Kredensial, PPI, Aset, Penggajian, PPRA, Dokumen regulasi, Pengaduan, Pendidikan, Dataset riset, pratinjau Aplikasi pasien dan Aplikasi dokter.
- **Aliran:**
  - Logistik: ROP → PO → penerimaan → stok + hutang (CX-2);
  - indikator Mutu dan Dasbor dihitung dari kejadian toko, tidak diketik;
  - Command center membaca bed/IGD/antrean dari toko;
  - aplikasi pasien: booking → antrean (CD-3) + tagihan (CX-2);
  - aplikasi dokter: nilai kritis read-back → Hasil kritis (CX-1).
- **Utang bug 6 Okt:** pemisahan pembuat ≠ penyetuju di Penggajian/ROI/Dokumen/Dataset memakai sesi; langkah komite PPRA/RKK hanya peran yang berhak.

### CX-4 · Konsistensi data antarlayar + QA aksesibilitas (gelombang 2)

- **Isi:**
  1. Uji otomatis yang membandingkan angka sama di layar berbeda: total tagihan, tarif INA-CBG, KPI Dasbor vs Mutu vs Akuntansi, stok vs PO, bed vs command center.
  2. Pemeriksaan aksesibilitas: label, kontras ≥ 4,5:1, target ≥ 44 px (anjungan ≥ 64 px), status tidak hanya warna. Pakai Playwright + aturan sederhana, tanpa dependensi baru.
- **Perbaikan:** dikirim ke pemilik domain lewat handoff. Bila pemilik domain sudah selesai dan sepakat, CX-4 boleh memperbaiki sendiri dengan diff kecil.

## 8. Keputusan pemilik produk yang ditunggu

| ID  | Pertanyaan                                                                                                   | Menghambat           | Usulan bawaan                                                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------ | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| K-1 | Siapa yang boleh memulangkan pasien dengan disposisi **meninggal**?                                          | CD-2 (alur demo), backend 3.6 | Hanya dokter yang berelasi dengan pasien; wajib jam kematian + sebab kematian ICD-10 + surat keterangan kematian ber-TTE; admisi ditolak. |
| K-2 | Bolehkah periode akuntansi ditutup bila masih ada jurnal yang menunggu penyetuju kedua?                      | CX-2                 | Tidak boleh; tutup periode diblokir sampai antrean persetujuan kosong.                                                                                         |

## 9. Backlog backend (ditunda)

Belum dijadwalkan. Urutan dan rinciannya mengikuti `docs/rencana/fase-3-klinis-rme.md` §2 dan rencana fase 4–10.

- **3.7** Persetujuan tindakan + edukasi.
- **3.8** Konsultasi, paket layanan, dokumen pasien.
- **3.6** Resume + pulang + `DischargeGate` (K-1).
- **W1–W5b** Sambungkan layar Poli, CPOE, IGD + Tempat tidur, Rawat inap, Persetujuan, Resume ke API.
- **3.9** Penutup fase 3.
- Perbaikan deadlock transfer ADT dan urutan status IGD.
- Katalog izin dan peran rencana.
- Fase 4–10.

Saat backend dilanjutkan, kontrak data toko demo (§6 CD-1) menjadi acuan bentuk respons API, mengikuti ADR-0023 keputusan 4.

## 10. Memulai tugas

**Claude Code:** CD-0 menjalankan CD-n sebagai agen di worktree terpisah. Cara manual:

```bash
cd /Users/godam/PROYEK/simrs
claude --worktree cd-1
```

**Codex:** satu perintah dari checkout utama menyiapkan semuanya, lalu menjalankan Codex dengan prompt tugas:

```bash
node scripts/codex-tugas.mjs CX-0          # sesi Codex interaktif
node scripts/codex-tugas.mjs CX-0 --exec   # tanpa interaksi; pesan akhir di ~/.codex/worktrees/cx-0/hasil-terakhir.md
node scripts/codex-tugas.mjs CX-0 --dry-run # lihat langkah dan prompt saja
```

Yang disiapkan skrip (tidak destruktif; yang sudah ada dipakai ulang):

1. Worktree `~/.codex/worktrees/<cx-n>/simrs` di branch `codex/<cx-n>` dari `master`.
2. Salinan `.env` lokal.
3. Database tes slot §4 (hanya `CREATE` bila belum ada).
4. `pnpm install` + `pnpm build`.
5. Codex dijalankan dengan:
   - sandbox `workspace-write` + jaringan lokal;
   - akses tulis ke direktori git repo untuk commit di worktree;
   - variabel slot (URL database tes, port E2E) yang menimpa `.env`.

Codex tidak mendapat akses tulis ke checkout utama. Untuk melanjutkan tugas yang terputus, jalankan perintah yang sama: worktree dan handoff `docs/handoff/<CX-n>.md` dipakai ulang.

Prompt yang dikirim skrip (bisa juga ditempel manual di Codex app pada worktree tugas):

```text
Kerjakan tugas CX-0 dari docs/13-pembagian-tugas-cd-cx.md di worktree ~/.codex/worktrees/cx-0/simrs
(branch codex/cx-0). Fokus front end mode presentasi; backend ditunda. Baca AGENTS.md, CLAUDE.md,
docs/12-codex-claude.md, docs/13-pembagian-tugas-cd-cx.md, docs/PROGRESS.md, docs/adr/0023-*.md, dan
docs/panduan/19-peta-kode.md. Salin docs/handoff/TEMPLATE.md menjadi docs/handoff/CX-0.md dan perbarui
setelah tiap potongan. Hanya sunting berkas milik tugas ini (§2), pakai database dan port slot tugas ini (§4).
Jangan menggabungkan ke master dan jangan menyunting checkout utama; setelah gerbang hijau, tandai handoff
"siap integrasi".
```
