# Rencana fase 10 · Simulasi end-to-end, ketahanan, dan persiapan pilot

Disusun 5 Okt 2026 oleh agen R. Keputusan di §4 diambil dan disetujui otomatis 5 Okt 2026. ADR 0070–0075.

## 1. Ringkasan

Fase 10 membuktikan alur penuh di backend nyata dan menyiapkan pilot:

- **Seed skenario + tenant latihan.**
- **E2E Playwright tiga skenario** `Simulasi.dc.html` dari kedatangan sampai klaim/pembiayaan:
  - rawat jalan BPJS
  - IGD → rawat inap
  - elektif TPDI × BTN
- **`/simulasi` mode api** sebagai pelacak skenario non-produksi. Jalur demo, `pnpm demo`, dan QA visual tetap hidup.
- **Beban:** k6 + perbaikan performa.
- **P13 server edge:** desain + prototipe sinkron dua arah untuk registrasi, mode downtime, entri susulan, cetak darurat, log insiden.
- **Backup terenkripsi tiga lokasi** + uji restore di mesin bersih.
- **Hardening + utang "fase 10" di PROGRESS:**
  - CSP nonce
  - jangkar hash audit + checkpoint
  - ringkasan anomali terjadwal
  - rate limit Redis per pengguna
  - peta refresh web bersama
  - rotasi kunci kolom
  - FK `NOT VALID`
  - daftar sandi bocor
  - pencarian trigram di bawah RLS
- **Dokumen go-live:** runbook, matriks 51 EP MRMIK berbukti, konektor sandbox, rencana pilot, DPIA, NFR.

**Urutan pengerjaan:**

1. Kontrak, lalu DB.
2. Gelombang fondasi: seed, P13, backup, hardening.
3. E2E, simulasi, downtime, audit.
4. Beban, review, dokumen.
5. Penutup.

**Prasyarat:** DoD fase 2–9 hijau. Skenario E2E menyentuh semua modul.

**Antarmuka yang dibutuhkan:**

| Fase    | Antarmuka                                                                                                         |
| ------- | ----------------------------------------------------------------------------------------------------------------- |
| 1 (P05) | Kunci kolom turunan HKDF per tenant bisa diekspor terpisah dari kunci induk (edge hanya memegang kunci tenantnya) |
| 1 (P08) | Driver penyimpanan S3/MinIO (bila fase 7 belum membuatnya, 10.7 membuatnya)                                       |
| 2       | Penomoran P08 bisa "menyewakan blok"                                                                              |
| 2       | Antrean edge-otoritatif                                                                                           |
| 2       | Hub SSE                                                                                                           |
| 3       | Kolom `occurred_at`/`recorded_at`/`back_entry` + `downtime_incident_id` di entri klinis                           |
| 3       | `encounter_status_history` append-only                                                                            |
| 3       | Data paket cetak darurat per ruang: daftar pasien, alergi, obat aktif, jadwal eMAR 8 jam, CPPT terakhir           |
| 4–6     | Semua endpoint langkah skenario                                                                                   |
| 5       | Tarif U01 per item skenario                                                                                       |
| 6       | Panel mock TPDI/BTN dapat dipicu lewat HTTP untuk E2E                                                             |
| 7       | Layar Integrasi menampilkan `replicationLagSeconds` + `backups` + uji downtime dari endpoint 10.5/10.7            |
| 7       | Kirim SATUSEHAT/E-Klaim berstatus terbaca di uji                                                                  |
| 8       | Kelengkapan RM untuk ringkasan skenario                                                                           |
| 9       | Aplikasi pasien/dokter di skenario (antrean, read-back)                                                           |

## 2. Potongan kerja (urut dependensi)

### 10.0a · Kontrak bersama

**Izin:**

- `simulation.use` (hanya non-produksi).
- `system.downtime`: read, manage.
- `backup.read`.
- `print.emergency`.
- Prinsipal tetap **node sinkron**: `sync.push`, `sync.pull`.

**Skema:**

- `simulationRunSchema`: tahap → status dari peristiwa nyata.
- `downtimeStatusSchema`, `backupRunSchema`, `restoreTestSchema`, `syncChangeSchema`.

**Pengaturan:** `downtime.read_only`, `downtime.banner`, `edge.sync_interval_seconds` (10), `edge.number_block_size` (1000), `backup.*`.

**Kode galat:** `SYSTEM_READ_ONLY`, `SYNC_CONFLICT`, `RETENTION_ELECTRONIC_DISABLED` (fase 8).

### 10.0b · Skema DB (setelah 10.0a)

| Tabel                                           | Isi dan aturan                                                                                                        |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `simulation_runs`                               | Skenario, pasien/kunjungan, pemulai                                                                                   |
| `downtime_incidents` + `downtime_announcements` | Jenis, mulai/selesai, dampak, jumlah entri susulan, RTO/RPO aktual, evaluasi (MRMIK 13.1c)                            |
| `system_health_checks`                          | Agregat per jam                                                                                                       |
| `sync_nodes`                                    | Kunci publik node                                                                                                     |
| `sync_changes`                                  | Append-only; UNIQUE id perubahan                                                                                      |
| `sync_cursors`                                  | Posisi per node × peer                                                                                                |
| `sync_conflicts`                                | Konflik yang dicatat                                                                                                  |
| `number_block_leases`                           | Blok nomor yang disewa edge                                                                                           |
| `audit_anchors`                                 | Append-only                                                                                                           |
| `audit_daily_summaries`                         | Ringkasan harian                                                                                                      |
| `backup_runs` + `restore_tests`                 | Di tenant PLATFORM. RS membaca ringkasan lewat fungsi `SECURITY DEFINER` sempit `app_backup_status()` (pola ADR-0008) |

**Peran DB `simrs_backup`:** `pg_read_all_data` + BYPASSRLS, hanya dipakai kontainer ops, bukan kode aplikasi. Mencatat hasil lewat `app_record_backup_run()`.

**Tes:** RLS, append-only, fungsi status tidak membocorkan detail lokasi/kunci, peran aplikasi tidak bisa memakai `simrs_backup`.

### 10.1 · Seed skenario + tenant latihan

**Seed skenario:** `packages/db/scripts/seed-scenarios.ts` (`pnpm db:seed-skenario --tenant RSCM`, ditolak bila `APP_ENV=production`).

- Pasien fiktif: Tn. Suryo, Tn. Hartono, Ny. Ratna, dengan RM/NIK fiktif yang sama dengan fixture demo.
- Praktisi, jadwal + kuota tanggal berjalan, booking `2610050117`, kartu BPJS mock, alergi/riwayat.
- **Tarif U01 diatur agar total sama dengan golden demo:** Rp 806.000 / Rp 10.620.000 / Rp 17.905.000.
- Fasilitas pembiayaan BTN, rekening RS.
- Idempoten; ID tetap.

**Tenant latihan:** `pnpm db:seed-latihan --tenant RSCM` membuat tenant `RSCM-LATIH` (data fiktif, banner "Lingkungan latihan") untuk pelatihan per peran (MRMIK 2a) dan latihan downtime (13.1b).

**Tes:** seed dua kali hasilnya sama; tarif menghasilkan total golden.

### 10.2 · E2E tiga skenario (api), setelah 10.1

**Berkas:**

- `apps/web/e2e/skenario/{rawat-jalan,igd-ranap,elektif-btn}.spec.ts` (`describe.serial` per tahap).
- Helper `apps/web/e2e/support/{mock-control.ts, scenario-seed.ts, db-assert.ts}`. `mock-control.ts` membungkus: reset mock, bayar VA/QRIS, webhook ganda, BPJS bayar klaim, ubah status verifikator, setujui/cairkan pembiayaan.

**Asersi per tahap:**

- Status kunjungan.
- Audit pasien.
- Task BPJS 1–7 `sent`.
- SATUSEHAT Encounter → anak, berurutan.
- Charge per sumber; total = golden.
- Jurnal seimbang.
- Klaim sampai layak bayar/dibayar.
- Pembiayaan drawdown → pelunasan otomatis (elektif).
- Gerbang keselamatan (CDS, nilai kritis read-back, gelang eMAR, time-out OK) tetap memblokir.

**Segmen multi-hari** (rawat inap hari 1–3, H+1 rekonsiliasi): dibuat `scenario-seed.ts` sebagai riwayat fiktif di DB uji. Tanpa jam palsu di server.

**DoD:** ketiga skenario hijau.

### 10.3 · `/simulasi` mode api + pemeliharaan jalur demo (ADR-0074)

**API:**

- Modul `apps/api/src/modules/simulation/**` hanya didaftarkan bila `APP_ENV ≠ production` (pola dev-tools ADR-0010).
- `GET /simulation/runs/:scenario`: tahap dihitung dari riwayat status, outbox, charge, dan klaim nyata.
- `POST /simulation/runs`: "Mulai ulang" = run baru dengan klon pasien fiktif ber-RM baru, tanpa hapus.
- Izin `simulation.use`.

**Web:**

- `apps/web/src/app/(staf)/simulasi/{page.tsx, demo-simulasi.tsx, api-simulasi.tsx}`: tautan ke layar nyata per tahap, tanpa aksi pintas.
- `scripts/demo.mjs --sumber=api`: presentasi dengan backend nyata + seed skenario.
- `scripts/demo-cek.mjs` memeriksa seed skenario.

**Tes:**

- E2E `e2e/simulasi-api.spec.ts`: produksi 404, lokal menampilkan progres setelah langkah nyata.
- E2E demo simulasi tetap hijau.
- QA visual mencakup layar api fase 8–10.

### 10.4 · Beban + perbaikan performa

**Skrip beban:**

- `infra/k6/{registrasi,cppt,kasir,antrean-sse}.js` dijalankan lewat image Docker `grafana/k6`. Tanpa dependensi npm.
- `pnpm db:seed-volume --patients 50000` (fiktif).
- Sasaran p95 < 300 ms (NFR usulan).
- Laporan di `.local/beban/`.

**Perbaikan yang diantisipasi:**

- Pencarian nama: fungsi `SECURITY DEFINER` sempit atas indeks nama (utang P05).
- Cache matriks izin per tenant + invalidasi (utang P03).
- Paralelisme dispatcher terbatas (bila fase 7 belum).
- Advisory lock audit dipantau.

**Tes:** ambang k6 sebagai gerbang manual; regresi unit untuk fungsi pencarian (RLS tetap, tenant B tidak terlihat).

### 10.5a · P13 desain + fondasi sinkron (ADR-0070)

**Topologi:**

- Cloud multi-tenant.
- Edge per RS = API + Postgres satu tenant, skema dan migrasi sama, RLS tetap aktif.
- Kunci kolom di edge hanya kunci turunan tenantnya (CLI `pnpm db:export-tenant-keys`, disegel `age` ke kunci publik node).

**Penangkapan perubahan:**

- Trigger `app_sync_capture()` pada tabel prototipe menulis `sync_changes` dalam transaksi yang sama.
- GUC `app.node_id` menandai asal perubahan.
- `app.sync_apply` mencegah putaran ulang.

**Transport:**

- Job worker `sync.push`/`sync.pull` tiap 10 detik.
- Endpoint `/api/v1/sync/{changes,ack}` untuk prinsipal node: permintaan bertanda tangan HMAC, mTLS di produksi.
- Kursor per peer = ID perubahan UUID v7.

**Penerapan:**

- Baris append-only: sisip bila belum ada (idempoten).
- Baris berversi: versi tertinggi menang, lalu `recorded_at` asal, lalu `node_id`. Konflik dicatat.
- Riwayat status digabung; status kini dihitung ulang.

**Penomoran:** blok RM/kunjungan disewa edge saat online. Nomor antrean milik edge.

**Tes db:** penerapan ganda idempoten, putaran ulang tercegah, konflik deterministik, blok tidak tumpang tindih.

### 10.5b · Prototipe sinkron dua arah registrasi (setelah 10.5a)

**Lingkup tabel:** `patients`, `patient_identifiers`, `encounters`, `encounter_status_history`, `coverages`, `queue_tickets`.

**Skrip lokal:** `scripts/dev-edge.mjs` (`pnpm dev:edge`) menjalankan dua API + dua database lokal (`simrs` sebagai cloud, `simrs_edge` sebagai edge), memakai `with-pg`.

**Layar:**

- Status replikasi di layar Integrasi (`replicationLagSeconds` nyata).
- Pasien baru dari edge saat offline masuk antrean duplikat MPI P05 setelah sinkron; tidak digabung otomatis.

**Tes integrasi `apps/api/test/sync.test.ts`:**

- Cloud diputus → daftar pasien + kunjungan di edge → sambung → muncul sekali di cloud.
- Perubahan status serentak → hasil sama di kedua sisi.
- Nomor RM tidak bentrok.
- Node tenant lain ditolak.

### 10.6 · Mode downtime, entri susulan, cetak darurat (ADR-0075)

**Status dan banner:**

- `GET /system/status` + banner web `apps/web/src/components/system-status-banner.tsx`.
- Pengumuman downtime terencana (`system.downtime.manage`).

**Baca-saja terencana:** guard global menolak tulis dengan 503 `SYSTEM_READ_ONLY`, kecuali daftar putih (masuk/keluar, akses darurat).

**Downtime tak terencana:** edge melayani baca + registrasi.

**Entri susulan:**

- Centang "entri susulan" + alasan + waktu klinis.
- Ditandai `back_entry` + `downtime_incident_id` dan muncul di laporan entri terlambat B09.

**Paket cetak darurat:**

- Job P11 tiap 4 jam di edge: HTML cetak per ruang disimpan terenkripsi di disk edge.
- Halaman `apps/web/src/app/(staf)/darurat/cetak/page.tsx` (izin `print.emergency`, audit `print`, watermark).

**Log insiden + evaluasi:**

- Layar `apps/web/src/app/(staf)/sistem/downtime/page.tsx`: RTO/RPO aktual vs target (MRMIK 13.1c).
- Pemantau kesehatan berkala.

**Tes:**

- Tulis ditolak saat baca-saja.
- Entri susulan tanpa alasan → 400.
- Paket cetak hanya pasien unit penugasan; tercatat audit.
- Mode latihan di tenant latihan tidak menyentuh tenant produksi.

### 10.7 · Backup terenkripsi tiga lokasi + uji restore (ADR-0071)

**Backup:**

- Kontainer ops `infra/backup/` (profil compose `backup`: `postgres:16-alpine` + `age` + `mc`) menjalankan `backup.sh`:
  - `pg_dump -Fc` sebagai `simrs_backup`, dienkripsi `age` ke kunci publik.
  - Per jam + harian.
  - Berkas dokumen ikut (tar terenkripsi).
- **Tiga lokasi:** `.local/backup/` (disk edge), bucket `simrs-backups` (cloud), bucket `simrs-backups-offsite` (`mc mirror`). Produksi memakai region/penyedia berbeda.
- Manifest berisi hash + jumlah baris per tabel.
- Hasil dicatat lewat `app_record_backup_run()`.

**Restore:**

- `restore-test.sh` (`pnpm backup:uji-restore`):
  1. Kontainer Postgres bersih.
  2. Dekripsi dengan kunci privat dari berkas runtime (tidak pernah di repo).
  3. `pg_restore`.
  4. `prisma migrate status`.
  5. Cocokkan jumlah baris dengan manifest.
  6. `/audit/verify` per tenant + bandingkan jangkar.
  7. API `/ready` menyala di atas DB hasil restore.
  8. Catat `restore_tests` dengan RTO terukur.
- Job mingguan.

**Utang dokumen lain:** driver S3 P08 + job pembersih berkas yatim (bila belum dibuat fase 7).

**Tampilan:** status backup di layar Integrasi (kontrak `backups`).

**Tes:**

- Skrip shell diuji `bats`-ringan atau Node.
- Restore ke kontainer baru berhasil.
- Manifest rusak → gagal keras.
- Kunci salah → gagal tanpa menimpa apa pun.

**DoD:** restore berhasil di mesin bersih, dengan bukti di runbook.

### 10.8 · Jangkar hash audit + checkpoint + ringkasan anomali (ADR-0072)

**Jangkar:**

- Job tiap jam menulis kepala rantai per tenant `{tenant, seq, hash, waktu}` + HMAC (`AUDIT_ANCHOR_KEY` terpisah) ke bucket MinIO ber-object-lock (WORM) dan ke `audit_anchors`.
- `/audit/verify` mulai dari checkpoint terakhir dan mendeteksi pemotongan baris terakhir (`TRUNCATION_DETECTED`).

**Ringkasan:**

- Job harian `audit_daily_summaries`.
- Layar Audit memakai ringkasan untuk rentang > 1 hari.

**Tes:** hapus baris terakhir sebagai superuser di DB uji → terdeteksi; ringkasan = agregasi langsung.

### 10.9a · Hardening web/API (ADR-0073)

**CSP:**

- `apps/web/src/proxy.ts` membangkitkan nonce per permintaan; `layout.tsx` meneruskannya.
- `script-src 'self' 'nonce-…' 'strict-dynamic'`, tanpa `unsafe-inline` skrip. Style tetap `unsafe-inline`.

**Rate limit:**

- Storage throttler Redis lewat ioredis yang sudah ada (tanpa paket baru).
- Batas per pengguna setelah autentikasi + per IP sebelumnya.
- Batas khusus realm pasien dan webhook.

**Sesi web multi-instans:** peta refresh di Redis (utang ADR-0013).

**Header:** verifikasi header keamanan API/web di mode produksi.

**Tes:**

- Header CSP tanpa `unsafe-inline` skrip dan halaman tetap hidrasi (E2E).
- Dua instans API berbagi kuota.
- Refresh paralel di dua instans web tidak mencabut sesi.

### 10.9b · Review keamanan semua modul + utang keamanan

**Review:**

- `/review-keamanan` per modul (fase 0–10) terhadap checklist docs/05 §5. Hasil di `docs/keamanan/review-fase-10.md`; temuan diperbaiki atau dicatat.
- `pnpm audit --prod` di CI.
- Pemindaian rahasia (gitleaks lewat Docker).

**Utang yang ditutup:**

- Rotasi kunci kolom v2 + job enkripsi ulang bertahap (utang P05).
- `VALIDATE CONSTRAINT` FK `NOT VALID`.
- Daftar sandi bocor besar (k-anonymity offline).
- HealthService HeadBucket.

**Desain saja:** ClamAV untuk unggahan produksi.

**Tes:** rotasi kunci — data lama tetap terbaca, data baru memakai v2, hash dibangkitkan ulang.

### 10.10 · Dokumen go-live

| Dokumen                            | Isi                                                                                                                                                                                                                                               |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/go-live/runbook.md`          | Deploy, start/stop, backup/restore + pemegang kunci, DLQ, downtime SOP, rotasi kunci, insiden, kontak                                                                                                                                             |
| `docs/MRMIK-MATRIX.md`             | Format perintah `/cek-mrmik`: EP · klasifikasi · status · bukti (berkas/tes/layar/prosedur) · tindakan. Semua 51 EP. EP tata kelola = "bukan ranah sistem" + templat dokumen RS                                                                   |
| `docs/go-live/konektor-sandbox.md` | BPJS VClaim/Antrean/Aplicare/HFIS, E-Klaim, SATUSEHAT, Dukcapil, TTE (BSrE/PSrE), TPDI, BTN VA/QRIS/H2H/pembiayaan, WhatsApp BSP, Expo/FCM/APNs, SIRS/RS Online, SISRUTE. Per konektor: status mock, dokumen resmi, pemilik kredensial, kasus uji |
| `docs/go-live/rencana-pilot.md`    | Modul, matriks pelatihan per peran, latihan downtime, kriteria go/no-go, hypercare                                                                                                                                                                |
| `docs/go-live/dpia.md`             | UU PDP; termasuk push Expo dan data ke BTN                                                                                                                                                                                                        |
| `docs/go-live/nfr.md`              | Konfirmasi RPO/RTO + rencana pgBackRest PITR produksi                                                                                                                                                                                             |

### 10.11 · Penutup fase 10

- Jalankan DoD.
- QA visual penuh + regresi demo.
- ADR-0070…0075.
- Panduan.
- PROGRESS.
- Laporan lolos / tidak lolos.

## 3. Paralelisasi (maks. 4 agen sekaligus)

**Gelombang:**

- 10.0a → 10.0b.
- **Gelombang A:** 10.1 ∥ 10.5a ∥ 10.7 ∥ 10.9a.
- **Gelombang B:** 10.2 ∥ 10.3 ∥ 10.5b ∥ 10.8.
- **Gelombang C:** 10.4 ∥ 10.6 ∥ 10.9b ∥ 10.10 (matriks diisi setelah bukti dari A/B tersedia).
- 10.11 oleh penggabung.

**Kepemilikan berkas:**

| Berkas                                                                              | Pemilik       |
| ----------------------------------------------------------------------------------- | ------------- |
| `apps/web/e2e/skenario/**`, `e2e/support/{mock-control,scenario-seed,db-assert}.ts` | 10.2          |
| `simulation/**`, `app/(staf)/simulasi/**`, `scripts/demo*.mjs`                      | 10.3          |
| `apps/api/src/modules/sync/**`, `scripts/dev-edge.mjs`, migrasi trigger sinkron     | 10.5a → 10.5b |
| `infra/backup/**`                                                                   | 10.7          |
| `infra/k6/**`                                                                       | 10.4          |
| `apps/web/src/proxy.ts`, `next.config.ts`, throttler API                            | 10.9a         |
| `docs/go-live/**`, `docs/MRMIK-MATRIX.md`                                           | 10.10         |
| `docs/keamanan/**`                                                                  | 10.9b         |
| Guard baca-saja global (`apps/api/src/common/`)                                     | 10.6          |

Migrasi memakai blok cap waktu per potongan. PROGRESS hanya diubah agen penggabung.

## 4. Keputusan (keputusan diambil, disetujui otomatis 5 Okt 2026)

1. **`/simulasi` mode api** = pelacak skenario non-produksi tanpa aksi pintas. Modul tidak didaftarkan di produksi. "Mulai ulang" membuat run + pasien fiktif baru (tanpa hapus). Jalur demo tetap (ADR-0074).
2. **Seed skenario:** tarif diatur agar total sama dengan golden demo. Tersedia `pnpm demo --sumber=api`.
3. **Segmen multi-hari** E2E dibuat sebagai riwayat fiktif di DB uji. Tidak ada jam palsu di server (waktu catat tetap dari server, MRMIK 8b).
4. **Beban:** k6 lewat Docker (opsional), tanpa dependensi npm; sasaran p95 < 300 ms.
5. **P13:** sinkron tingkat aplikasi (trigger change log + HTTPS bertanda tangan + kursor), bukan replikasi logis Postgres.
   - Edge = satu tenant.
   - Append-only digabung; berversi LWW deterministik + catatan konflik.
   - Blok penomoran sewaan.
   - Duplikat MPI ke antrean P05.
   - Edge hanya memegang kunci kolom tenantnya (ADR-0070).
6. **Downtime:** terencana = baca-saja global + pengumuman. Tak terencana = edge melayani baca + registrasi. Entri susulan wajib alasan + waktu klinis. Paket cetak darurat tiap 4 jam di edge (ADR-0075).
7. **Backup:**
   - `pg_dump -Fc` + `age` (kunci publik; kunci privat offline, dua pemegang) per jam + harian, tiga lokasi.
   - Peran `simrs_backup` (BYPASSRLS baca-saja) hanya di kontainer ops.
   - Uji restore mingguan di kontainer bersih.
   - PITR pgBackRest untuk RPO 15 menit di produksi (ADR-0071).
8. **Jangkar audit:** tiap jam ke bucket WORM + HMAC kunci terpisah; verifikasi berbasis checkpoint (ADR-0072).
9. **CSP & rate limit:** CSP ber-nonce lewat proxy Next; style tetap `unsafe-inline`. Rate limit Redis per pengguna lewat ioredis yang ada (ADR-0073).
10. **Tenant latihan** `<KODE>-LATIH` per RS untuk pelatihan dan latihan downtime.
11. **Matriks MRMIK** di `docs/MRMIK-MATRIX.md` mengikuti perintah `/cek-mrmik`; EP tata kelola diberi templat dokumen.
12. **Rotasi kunci kolom** v2 dengan enkripsi ulang bertahap sebelum pilot.
13. **ClamAV dan pgBackRest:** didesain di runbook, dipasang saat infrastruktur produksi.

## 5. Risiko & utang

- **E2E skenario panjang dan rapuh:** `describe.serial` per tahap, reset mock per skenario, port terpisah (`E2E_*`), tunggu berbasis status outbox (bukan sleep).
- **P13 hanya prototipe:** belum menyelesaikan clock skew (NTP wajib; HLC menyusul), modul klinis, kompresi/batch besar, maupun lokasi data. Dicatat sebagai utang produksi.
- **Pengecualian BYPASSRLS untuk backup:** terbatas pada kontainer ops; tidak boleh di runtime aplikasi; diuji.
- **Kehilangan kunci privat `age`** = backup tak bisa dipulihkan: prosedur dua pemegang + uji restore berkala.
- **CSP nonce** memaksa render dinamis. Semua halaman staf sudah dinamis; halaman publik (`/verifikasi`, `/survei`) diuji.
- **Kredensial sandbox resmi** (BPJS, SATUSEHAT, TPDI, BTN, TTE) di luar kendali tim → `konektor-sandbox.md` + kriteria go/no-go pilot.
- **Utang yang ditinggalkan:**
  - Sinkron edge untuk modul selain registrasi.
  - HLC.
  - Pemasangan pgBackRest/ClamAV.
  - Penetration test pihak ketiga.
  - Status SSE multi-instans dari ADR-0026, bila belum.

## 6. Definisi selesai fase 10 → potongan

| Kriteria                                                                            | Potongan                             |
| ----------------------------------------------------------------------------------- | ------------------------------------ |
| Ketiga skenario E2E hijau dari kedatangan sampai klaim/pembiayaan                   | 10.1, 10.2, 10.3, 10.11 (+ fase 2–9) |
| Restore dari backup berhasil di mesin bersih                                        | 10.0b, 10.7, 10.8, 10.11             |
| Matriks 51 EP terisi bukti (layar, tes, atau prosedur)                              | 10.10 (+ 10.6, 10.7, 10.8, 10.9b)    |
| (docs/09) P13 desain + prototipe sinkron registrasi + mode downtime + cetak darurat | 10.5a, 10.5b, 10.6                   |
| (docs/09) Hardening: rate limit, CSP, header, `pnpm audit`, checklist semua modul   | 10.9a, 10.9b                         |
| Aturan umum                                                                         | setiap potongan; diperiksa di 10.11  |
