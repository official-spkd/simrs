# PROGRESS

Diperbarui oleh Claude Code di akhir setiap potongan kerja. Format: centang kriteria, catat keputusan, utang teknis, dan langkah berikutnya.

## Status fase

| Fase | Nama                               | Status                                                                                |
| ---- | ---------------------------------- | ------------------------------------------------------------------------------------- |
| 0    | Fondasi repo dan infrastruktur     | 🟨 hampir selesai: tinggal tes BullMQ + `/ready` hijau (butuh Redis/MinIO via Docker) |
| 1    | Platform inti                      | 🟨 berjalan (fase 0: 2 kriteria menunggu Docker, disetujui lanjut)                    |
| 2    | Front office                       | ⬜                                                                                    |
| 3    | Klinis RME                         | ⬜                                                                                    |
| 4    | Penunjang                          | ⬜                                                                                    |
| 5    | Keuangan                           | ⬜                                                                                    |
| 6    | Pembayaran TPDI × BTN + pembiayaan | ⬜                                                                                    |
| 7    | Integration hub + SATUSEHAT        | ⬜                                                                                    |
| 8    | Back office                        | ⬜                                                                                    |
| 9    | Dasbor + aplikasi mobile           | ⬜                                                                                    |
| 10   | Simulasi E2E, ketahanan, pilot     | ⬜                                                                                    |

Legenda: ⬜ belum · 🟨 berjalan · ✅ selesai · ⛔ terhambat

## Fase 0 · potongan

| #   | Potongan                                                                                                              | Status | Bukti                                                                              |
| --- | --------------------------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------- |
| 1   | Workspace pnpm + Turborepo + `packages/config`                                                                        | ✅     | commit `chore(repo)`                                                               |
| 2   | `packages/shared` (uang bigint, tanggal WIB, galat, env + APP_ENV gagal aman, UUID v7, 81 komponen, kripto BPJS/TPDI) | ✅     | 17 tes unit                                                                        |
| 3   | `packages/ui` + `apps/web` (AppShell, Sidebar, komponen dasar, `/dev/ui`)                                             | ✅     | 6 tes komponen, 12 tes unit web                                                    |
| 4   | `apps/mock` 7 sistem + panel kendali (bind 127.0.0.1)                                                                 | ✅     | 12 tes                                                                             |
| 5   | `packages/db` Prisma + RLS + `withTenant` + outbox + persiapan tes non-destruktif                                     | ✅     | 8 tes integrasi di Postgres 16 (portabel)                                          |
| 6   | `apps/api` health/ready/Swagger/galat/request-id/tenancy + hardening                                                  | ✅     | 27 tes (termasuk mode produksi, rate limit, header keamanan, 413)                  |
| 7   | `apps/worker` outbox → mock, retry, DLQ (BullMQ)                                                                      | 🟨     | 11/12 tes; tes BullMQ menunggu Redis (gagal cepat, sengaja tidak dilewati)         |
| 8   | Skrip root, Playwright smoke, README per aplikasi                                                                     | ✅     | Playwright 20 tes (Edge, desktop + tablet)                                         |
| +   | Panduan superadmin (`/superadmin/panduan`) + README pengembang (`docs/panduan/`)                                      | ✅     | 12 tes unit web + 10 tes Playwright; gerbang produksi diverifikasi di `next start` |

### Definisi selesai fase 0

- [ ] `docker compose up -d` + `pnpm dev` menjalankan semua aplikasi tanpa galat. API (via `main.ts`), web, dan mock sudah diverifikasi jalan; worker butuh Redis.
- [ ] `GET /ready` hijau (DB, Redis, MinIO). Saat ini DB hijau; Redis dan MinIO butuh Docker.
- [x] Tes membuktikan RLS: query tanpa `app.tenant_id` gagal (`TENANT_REQUIRED`); tenant A tidak melihat/menulis/mengubah baris tenant B
- [x] Pesan outbox contoh terkirim ke target; target gagal → retry eksponensial → DLQ; galat permanen langsung DLQ; target pulih → terkirim (dispatcher, diuji dengan Postgres). Penjadwalan BullMQ menunggu Redis.
- [x] `/dev/ui` menampilkan token dan komponen dasar sesuai Fondasi
- [x] README per aplikasi singkat; `PROGRESS.md` diperbarui

### Penghambat

- **Docker belum jalan**: firmware virtualisasi aktif, tetapi hypervisor Windows belum menyala. Perlu `wsl --install --no-distribution` (PowerShell Admin) lalu restart. Sementara itu Postgres dijalankan dengan `pnpm pg:portable` (ADR-0009).

## Fase 1 · potongan

Disetujui 4 Okt 2026: lanjut meski fase 0 kurang 2 kriteria (menunggu Docker); RS dikenali dari subdomain (produksi) + kolom kode RS (lokal); urutan potongan 1 dan 2 ditukar agar modul P01 langsung memakai fondasi audit.

| #   | Potongan                                                                                                                                                                                                                                                                                                                  | Status                                                          | Bukti                                                                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2   | P04 inti: transaksi per permintaan (`@TenantScoped`), `@Audited` di transaksi yang sama, hash berantai via trigger + verifikasi                                                                                                                                                                                           | ✅                                                              | db 12 tes (paralel, waktu server, tamper), api 34 tes                                                                                                      |
| 1   | P01 struktur RS (faskes, unit, ruang→kamar→bed) + P08 penomoran + P10 modul aktif + P12 pengaturan                                                                                                                                                                                                                        | ✅                                                              | db 20 tes (nomor paralel/batal, FK komposit, CHECK), api 44 tes; seed 12 unit + 5 kamar per RS                                                             |
| 3   | P02 identitas & login: argon2id, TOTP + anti-replay, sesi buram berotasi + deteksi pemakaian ulang, kunci akun, MFA wajib, subdomain/kode RS                                                                                                                                                                              | ✅ (PIN perangkat & OTP cadangan email menyusul)                | shared 45 tes (vektor RFC 6238), api 61 tes (17 auth), diulang 2× stabil                                                                                   |
| 4   | P03 otorisasi: 16 peran + matriks per RS, penugasan per sesi, `@RequirePermission`, ABAC relasi pasien, break-the-glass + tinjauan, kelola pengguna                                                                                                                                                                       | ✅                                                              | db 24 tes (schema-guard), api 98 tes (37 otorisasi: 16 peran × aksi, relasi/darurat, race admin terakhir, anti-eskalasi)                                   |
| 5a  | Layar Login (BFF cookie httpOnly, proxy pembaru sesi, MFA + QR, ganti sandi, pilih unit), tenant PLATFORM + `superadmin_platform`, CLI `db:create-admin`, `TRUST_PROXY`                                                                                                                                                   | ✅ (PIN perangkat, OTP cadangan, "percayai perangkat" menyusul) | api 106 tes, db 26, shared 51, web 24 unit + 40 E2E stack penuh (desktop + tablet)                                                                         |
| 5b  | Layar Akses: KPI reviu akses, daftar + filter (peran/status/cari), undang pengguna (sandi sementara sekali tampil), reset sandi/MFA, nonaktif/aktif, penugasan (tambah/akhiri dengan alasan), editor matriks izin                                                                                                         | ✅                                                              | api 110 tes (`/iam/summary`, `/iam/users/:id`, filter), web 29 unit + 51 E2E (siklus undang → login pertama, matriks, peran baca-saja)                     |
| 6   | Layar Audit (P04): filter + detail + verifikasi rantai, temuan anomali + tinjauan, tinjauan & laporan harian akses darurat, ekspor CSV bukti akreditasi; perbaikan zona waktu sesi DB                                                                                                                                     | ✅                                                              | api 116 tes (21 layar audit: 5 jenis temuan, tinjauan + 403/409/400, CSV anti formula injection, laporan harian), db 28 (zona waktu), web 36 unit + 61 E2E |
| 7a  | P05 MPI inti: pasien + identifier terenkripsi (NIK/BPJS/IHS/paspor) + blind index, cari (RM/NIK/BPJS/IHS/nama trigram), detail tersamar + buka identitas utuh diaudit, cegah NIK ganda (kunci per nilai), ABAC relasi + penolakan diaudit, FK relasi/akses darurat → pasien, 200 pasien fiktif                            | ✅                                                              | shared 61, db 34 (enkripsi tersimpan, trigram, CHECK, hak kolom, FK), api 128 (12 MPI: NIK ganda serentak, audit per pasien tampil, ABAC, isolasi)         |
| 7b  | Layar MPI (`/rekam-medis/mpi`): deteksi kandidat duplikat saat daftar/ubah (skor tanpa PHI, NIK salah ketik), antrean + banding atribut, gabung berjejak (pilih sumber per atribut, snapshot A terenkripsi), bukan orang yang sama, batal ≤ 30 hari, akses relasi mengikuti kelompok rekam medis, kunci MPI anti-deadlock | ✅                                                              | shared 68, db 39 (deteksi, `app_patient_group`, batasan), api 137 (9 MPI: gabung/batal/serentak 3×3 tanpa deadlock), web 39 unit + 67 E2E                  |
| 7c  | Verifikasi NIK ke Dukcapil lewat outbox (otomatis saat NIK dicatat + verifikasi ulang; worker membaca/mendekripsi NIK, hasil per elemen tanpa PHI diproses atomik, audit `system`; mock `verify-data`) + persetujuan privasi (catat, cabut beralasan, riwayat utuh)                                                       | ✅                                                              | mock 14, worker 15/16 (4 Dukcapil; sisa 1 = Redis), api 142 (verifikasi + persetujuan)                                                                     |
| 8   | P06 master rujukan: skema `ref` global (hanya baca), impor CSV gagal-tertutup (CLI `db:import-ref`, check digit LOINC, `--replace`/`--dry-run`), pencarian kode/label tahan salah ketik, wilayah berjenjang, API baca, 72 kode contoh dari mockup                                                                         | ✅                                                              | shared 71, db 47 (parser CSV, impor ter-rollback, hak baca saja), api 147 (5 rujukan); CLI dicoba di DB lokal                                              |
| 9   | P07 form engine + layar Formulir                                                                                                                                                                                                                                                                                          | ⬜                                                              |                                                                                                                                                            |
| 10  | P09–P11 dokumen, TTE, notifikasi, seed staf                                                                                                                                                                                                                                                                               | ⬜                                                              |                                                                                                                                                            |
| 11  | Penutup fase 1                                                                                                                                                                                                                                                                                                            | ⬜                                                              |                                                                                                                                                            |

### Definisi selesai fase 1

- [x] Login + MFA berjalan; akun tanpa MFA tidak bisa membuka modul sensitif (API: sesi tanpa MFA hanya ke endpoint akun; web: akun baru wajib daftar MFA + ganti sandi sebelum halaman staf; diuji E2E)
- [x] Matriks izin: tes otomatis untuk ≥ 10 kombinasi peran × aksi × relasi (`apps/api/test/authz.test.ts`: 16 kombinasi peran × aksi + relasi aktif/berakhir + akses darurat)
- [x] Setiap baca/ubah data pasien menghasilkan `audit_events`; hash berantai terverifikasi oleh tes (P05: cari, detail, daftar, ubah, buka identitas utuh, dan penolakan ABAC diaudit dengan `patientId`; `apps/api/test/patients.test.ts` + verifikasi rantai)
- [x] Break-the-glass mencatat alasan dan muncul di laporan (alasan di audit + `break_glass_grants`; layar Audit: tinjauan dari tautan notifikasi, temuan "belum ditinjau", laporan harian; diuji API + E2E)
- [x] Merge MPI tidak menghapus apa pun dan bisa ditelusuri (B hanya ditandai `merged` + rujukan ke A; data B utuh; `patient_links` + audit kedua pasien; batal ≤ 30 hari memulihkan nilai A; diuji API + E2E · ADR-0016)
- [ ] Koreksi form_response menghasilkan versi baru dengan alasan; diff tampil (P07, potongan 9)

## Langkah berikutnya

- Setelah Docker hidup: `pnpm infra:up` → `pnpm test` (tes BullMQ harus hijau) → `/ready` hijau → centang dua kriteria sisa → fase 0 ✅.
- Fase 1 potongan 9: P07 form engine berversi + layar Formulir (`design/mockups/Formulir.dc.html`): definisi formulir sebagai data, terbit berversi, isian berversi dengan koreksi beralasan + tampilan diff (kriteria fase 1).
- Pengembang lokal: setelah menarik perubahan ini jalankan `pnpm db:deploy`, `pnpm db:seed`, lalu `pnpm db:create-admin` (lihat tutorial §1) untuk bisa masuk di web.

## Asumsi yang dipakai (belum dikonfirmasi pemilik produk)

1. Integrasi alat lab, PACS, dan ICU dibangun setelah MVP; selama MVP hasil diinput manual (analyzer hanya disimulasikan di mock).
2. B01 supply chain, B03 data SDM inti, dan B09 RM administratif ikut MVP walau di lapisan 6.
3. Konektor nasional I01–I05 ikut MVP.
4. Aplikasi mobile menyusul (fase 9); web staf responsif tablet sejak awal.
5. Modul tersier (B08 PPRA, B10 pendidikan, B11 onkologi, I10 costing) fase lanjut, dapat dimatikan per tenant.
6. Tenant klinik (PCare) belum dilayani; struktur tenant tidak menutup kemungkinan itu.
7. NFR awal (usulan): 50 RS, 2.000 pengguna serentak, p95 API < 300 ms untuk operasi klinis, RPO 15 menit, RTO 4 jam.

## Keputusan selama pengembangan

- 3 Okt 2026 · Pengembangan langsung di Windows, bukan WSL; versi dikunci TS 6.0, Prisma 7.10, NestJS 12, Next 16, Vitest 5 · ADR-0007
- 3 Okt 2026 · RLS memakai `app_current_tenant()` yang melempar `TENANT_REQUIRED`; worker lintas tenant lewat `app_active_tenant_ids()` (SECURITY DEFINER sempit), tanpa BYPASSRLS · ADR-0008
- 3 Okt 2026 · Tes NestJS memakai transformer Oxc bawaan Vite (decorator legacy + metadata). SWC dibuang karena native binding gagal memvalidasi folder cache di mesin ini.
- 3 Okt 2026 · Playwright memakai Microsoft Edge bawaan Windows (`channel: msedge`), tanpa unduhan browser; `PW_CHANNEL=chromium` untuk CI Linux.
- 3 Okt 2026 · Port konsol MinIO dapat diatur (`MINIO_CONSOLE_PORT`, lokal 9011) karena 9001 dipakai Laravel Herd.
- 3 Okt 2026 · Status retry/DLQ outbox disimpan di Postgres (ikut RLS); BullMQ hanya menjadwalkan putaran dispatch. Klaim memakai lease 60 detik agar pesan tidak macet bila worker mati.
- 3 Okt 2026 · Tenant fase 0 diambil dari header `X-Tenant-Id`; mulai fase 1 dari klaim token (header hanya boleh cocok, selain itu `TENANT_MISMATCH`).

- 3 Okt 2026 · Postgres portabel (`embedded-postgres`) untuk mesin tanpa Docker; persiapan tes `migrate deploy` + upsert, tanpa reset · ADR-0009
- 3 Okt 2026 · `tenants` = registri: `ENABLE` tanpa `FORCE` RLS agar `app_active_tenant_ids()` bisa membaca; tabel domain lain tetap `FORCE` · ADR-0008 (revisi), migrasi `20261003010000`
- 3 Okt 2026 · `APP_ENV` gagal aman (tidak disetel/kosong/tak dikenal = production); modul `/dev` tidak didaftarkan di produksi; tenant dari header ditolak 401 di produksi · ADR-0010
- 3 Okt 2026 · Panduan superadmin dari `docs/panduan/*.md` (react-markdown, server-only, tanpa HTML mentah); peran `superadmin_platform` direncanakan fase 1 · ADR-0010
- 3 Okt 2026 · Hardening API: header keamanan tanpa helmet, rate limit per IP (`@nestjs/throttler`), body 1 MB, timeout koneksi, bind 127.0.0.1, log galat tanpa pesan (anti-PHI); worker: peta operasi `Map` + cek origin (anti-SSRF)

- 4 Okt 2026 · Satu transaksi bertenant per permintaan (AsyncLocalStorage) + audit ditulis sebelum commit (gagal tertutup); handler tidak boleh memanggil sistem eksternal (pakai outbox)
- 4 Okt 2026 · Hash berantai audit dihitung trigger database dengan advisory lock per tenant; waktu, seq, hash dari server; kanonik = larik JSON
- 4 Okt 2026 · `pnpm with-pg <perintah>`: Postgres portabel hanya selama perintah berjalan, dihentikan bersih lewat IPC (tanpa shell)

- 4 Okt 2026 · FK antar-tabel tenant memakai pasangan (tenant_id, id): FK tidak tunduk RLS
- 4 Okt 2026 · Paginasi kursor eksplisit `id > cursor` (UUID v7); `@RequireModule` dicek di dalam transaksi permintaan
- 4 Okt 2026 · Contoh tutorial modul API diganti ke `holidays` karena `units` kini kode nyata (P01)

- 4 Okt 2026 · Token sesi buram (bukan JWT), MFA wajib, Node ≥ 24.7 untuk argon2id bawaan · ADR-0011
- 4 Okt 2026 · Throttler `auth` terpisah (`AUTH_RATE_LIMIT_PER_MIN`) untuk endpoint kredensial

- 4 Okt 2026 · Otorisasi: katalog izin di kode, matriks per RS di DB (bawaan hanya untuk peran baru), satu penugasan per sesi, penolakan diaudit sebelum 403, lingkup `unit` sementara = `relationship` sampai ADT · ADR-0012
- 4 Okt 2026 · Pengaman admin: minimal satu admin aktif dengan advisory lock per tenant (write skew dibuktikan tes), akun/peran setara admin hanya dikelola `admin_tenant`, tidak ada ubah akses akun sendiri lewat menu admin · ADR-0012
- 4 Okt 2026 · Penugasan yang belum mulai dibatalkan sebagai rentang kosong (CHECK `>=`), migrasi `20261004040000`
- 4 Okt 2026 · Web = BFF: token di cookie httpOnly/SameSite=Lax (`__Host-` + Secure di luar lokal), mutasi lewat Server Action, langkah login dihitung di server, proxy memperbarui sesi sekali per refresh token, `requireSession()` di setiap halaman · ADR-0013
- 4 Okt 2026 · Tenant PLATFORM (`tenants.kind`) + peran `superadmin_platform` menggantikan gerbang `APP_ENV` area superadmin; izin `platform.*` tidak bisa diberikan ke peran RS; admin pertama via CLI `db:create-admin` (tanpa akun bawaan) · ADR-0013
- 4 Okt 2026 · API `TRUST_PROXY` (wajib di produksi, `true`/`*` ditolak); web meneruskan entri paling kanan `X-Forwarded-For` · ADR-0013
- 4 Okt 2026 · QR pendaftaran MFA dengan `uqr` (MIT, tanpa dependensi), dikirim sebagai data URI di `<img>`
- 4 Okt 2026 · E2E Playwright stack penuh (API :4010 + web build :3010, `simrs_test`), akun uji dibuat langsung di DB
- 4 Okt 2026 · Migrasi yang menambah FK ke tabel ber-`FORCE` RLS dibungkus `NO FORCE`/`FORCE`: validasi FK tanpa konteks tenant gagal `TENANT_REQUIRED`, bahkan untuk tabel baru yang kosong (dibuktikan di `simrs_scratch`). Tutorial 4a diperbaiki; `schema-guard.test.ts` menjaga FORCE terpasang lagi.

- 4 Okt 2026 · Sesi database Prisma dipaksa `TimeZone=UTC`: adapter `pg` menggeser waktu ±7 jam bila zona server Asia/Jakarta (tulis −7, baca waktu buatan DB +7); tampilan/pengelompokan WIB eksplisit. Data lokal fiktif sebelum perbaikan tidak dikoreksi · ADR-0014
- 4 Okt 2026 · FK komposit ke `users` dari `access_relationships`, `break_glass_grants` (pemakai + peninjau), `notifications`, migrasi `20261004060000`
- 4 Okt 2026 · Temuan anomali dihitung dari `audit_events` saat dibuka (tanpa tabel baru); tinjauan = entri audit `review` dengan kunci `jenis:pengguna:tanggal WIB` (append-only, tinjauan terbaru berlaku); ambang per RS lewat pengaturan `audit.*`
- 4 Okt 2026 · Ekspor CSV bukti akreditasi: izin `audit.export` (auditor mutu, petugas privasi; admin RS tidak), maks. 92 hari / 10.000 baris, BOM UTF-8, sel berawalan `= + - @` diberi `'`; diunduh lewat route handler BFF

- 4 Okt 2026 · MPI: identifier di `patient_identifiers` (AES-256-GCM + HMAC `sistem:nilai` per tenant, nilai permanen), RM di `patients.mrn` (tak bisa diubah), NIK ganda dicegah di API dengan kunci per nilai (bukan UNIQUE di DB karena data lama), tersamar bawaan + `reveal` berizin `patient.identity` · ADR-0015
- 4 Okt 2026 · Audit pasien: setiap pasien di hasil cari = `search` (tanpa teks pencarian), detail = `read`; penolakan ABAC (`AuditedDenial`) di-commit terpisah; temuan volume hanya `read`/`print`/`export` · ADR-0015
- 4 Okt 2026 · FK `access_relationships`/`break_glass_grants` → `patients` dipasang `NOT VALID` (baris uji lama merujuk pasien acak), migrasi `20261004070000`; akses darurat untuk pasien yang tidak ada → 404
- 4 Okt 2026 · Seed: 200 pasien fiktif RSFA (termasuk 5 pasangan duplikat seperti mockup MPI) + 30 RSFB, ID tetap (idempoten), satu transaksi per pasien; NIK berawalan 9999, BPJS 0000…, IHS P9999…
- 4 Okt 2026 · Gabung MPI = penanda `merged` + rujukan ke A, tanpa memindah/menghapus data; satu orang = kelompok `app_patient_group`; atribut dari B menimpa A dengan snapshot terenkripsi untuk batal ≤ 30 hari · ADR-0016
- 4 Okt 2026 · Deteksi duplikat: pra-saring SQL + skor di aplikasi (`scorePatientMatch`, ambang 40, NIK salah ketik lewat jarak edit), keputusan "bukan orang yang sama" tidak diusulkan ulang; data tak terbaca dilewati + peringatan · ADR-0016
- 4 Okt 2026 · Kunci MPI per RS (`lockMpi`) di awal semua alur yang menulis antrean: dua penggabungan serentak sebelumnya deadlock (`[500, 500, 200]`, penghitung deadlock Postgres naik); sesudahnya 3×3 serentak sukses, 0 deadlock · ADR-0016
- 4 Okt 2026 · Tes database dengan kunci enkripsi uji hanya memakai tenant baru (sebelumnya mencemari RSFA bersama dan menggagalkan E2E); tes pemalsuan ciphertext yang rapuh (1/64) diperbaiki
- 4 Okt 2026 · Operasi outbox: payload hanya ID (tanpa PHI), `prepare` membaca/mendekripsi DB tenant, `skip` untuk pesan yang tidak relevan, `onSuccess` atomik dengan pencatatan terkirim, respons sensitif tidak disimpan · ADR-0017
- 4 Okt 2026 · Dukcapil memakai pola verifikasi data (cocok per elemen, tanpa data pribadi) di mock `POST /dukcapil/verify-data`; worker kini butuh `FIELD_ENCRYPTION_KEY`/`FIELD_HASH_KEY` (skema env bersama `envSchemas.fieldCrypto`) · ADR-0017
- 4 Okt 2026 · Persetujuan privasi (`privacy_consents`): satu aktif per jenis/penerima, pencabutan hanya kolom `revoked_*`, audit tanpa nama penerima, migrasi `20261004090000`
- 4 Okt 2026 · Data rujukan di skema `ref` ditulis manual (di luar Prisma), impor CSV gagal-tertutup lewat CLI migrator, seed hanya 72 kode contoh dari mockup (`contoh-mockup`), wilayah tidak di-seed, pencarian trigram `<%` ambang 0,5 per transaksi · ADR-0018

## Utang teknis

- `apps/web` · menu sidebar memakai data statis; hitungan (antrean, IGD) dan status integrasi akan diisi dari API (fase 2 & 7).
- `apps/mock` · state di memori (hilang saat restart); cukup untuk lokal.
- `apps/api` · `HealthService` memakai endpoint kesehatan khusus MinIO; ganti dengan HeadBucket bila memakai S3 lain.
- `packages/db` · seed hanya 2 tenant; staf dan pasien fiktif menyusul di fase 1.
- `apps/web` · CSP masih `'unsafe-inline'` untuk skrip (hidrasi Next tanpa nonce); pindah ke CSP ber-nonce di hardening fase 10.
- `apps/api` · rate limit per IP di memori per instans; pindah ke penyimpanan Redis + batas per pengguna saat P02, dan set `trust proxy` saat di belakang load balancer.
- `apps/worker` · dispatcher mengirim berurutan per tenant; paralelkan terbatas bila volume naik (fase 7).
- `packages/db` · Rantai audit tidak mendeteksi penghapusan baris TERAKHIR (truncation); perlu jangkar hash berkala ke penyimpanan terpisah (fase 10).
- `packages/db` · Advisory lock audit per tenant menyerialkan penulisan audit dalam satu tenant sampai commit; pantau saat beban tinggi.
- `P02` · PIN login cepat per perangkat terdaftar dan OTP cadangan (email/WhatsApp) belum dibangun; menyusul bersama notifikasi (potongan 10).
- `P02` · Daftar kata sandi bocor masih statis kecil; produksi perlu daftar besar (mis. k-anonymity HIBP offline).
- `P03` · Izin baru di katalog tidak otomatis masuk ke peran RS yang sudah berjalan (bawaan hanya untuk peran baru); perlu migrasi data atau penyesuaian di layar Akses setiap menambah sumber izin.
- `P03` · Lingkup `unit` belum memakai lokasi pasien (menunggu ADT fase 2–3).
- `P03` · Matriks izin dibaca dari DB tiap permintaan berizin; tambahkan cache per tenant + invalidasi bila beban naik.
- `P03` · Notifikasi baru tersimpan in-app; pengiriman email/WhatsApp menyusul P11 (potongan 10).
- `apps/web` · Peta refresh sesi di memori satu proses: web multi-instans butuh sticky session atau penyimpanan bersama (Redis) + `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` yang sama (ADR-0013).
- `apps/web` · Login: PIN perangkat terdaftar, OTP cadangan WhatsApp/email, dan "percayai perangkat 12 jam" dari mockup belum dibangun (P02/P11, potongan 10).
- `apps/web` · Pergantian unit kerja di tengah sesi belum ada (sekarang: keluar lalu masuk lagi).
- `apps/web` · Layar Akses: "Sinkron dari data SDM" (B03) dan "Aturan kontekstual" (pasien VIP, shift) dari mockup belum ada; daftar pengguna berpaginasi maju saja (kursor).
- `scripts/with-pg.mjs` · Memuat seluruh `.env` root ke proses anak (termasuk `NODE_ENV=development`); E2E menimpa `NODE_ENV` untuk build web. Pertimbangkan daftar putih.
- `P04` · Temuan anomali dihitung dengan agregasi atas `audit_events` setiap layar dibuka (≤ 90 hari); untuk volume besar perlu ringkasan harian terjadwal (fase 10).
- `P04` · Jam dinas memakai satu pengaturan RS (`audit.night_hours`) + daftar peran jaga malam; jadwal dinas per staf menunggu data SDM (B03).
- `P04` · Tinjauan temuan bisa diberikan ulang (terbaru berlaku, riwayat tetap di audit), tetapi layar belum menampilkan riwayat tinjauan per temuan.
- `P04` · Pemeriksaan rantai penuh (`/audit/verify`) memindai seluruh jejak tenant; tambahkan titik periksa (checkpoint) bertanda tangan bila jejak sudah jutaan baris.
- `packages/db` · Log menampilkan `DeprecationWarning` pg (query bersamaan di satu koneksi): asalnya interpreter Prisma 7.10 (node `join` menjalankan sub-query relasi paralel di koneksi transaksi). Aman di pg@8 (diantrekan); periksa lagi saat Prisma atau pg naik versi (pg@9 menghapus antrean ini).
- `P05` · Pencarian nama: di bawah RLS indeks GIN trigram tidak terpakai (operator `%` pg_trgm tidak leakproof; EXPLAIN memakai indeks tenant + filter), jadi pencarian memindai pasien satu RS. Sebelum RS besar: fungsi `SECURITY DEFINER` sempit atas tabel indeks nama tanpa FORCE (pola ADR-0008), atau tandai fungsi pg_trgm LEAKPROOF bila superuser tersedia.
- `P05` · Ambang temuan volume masih satu angka per RS; petugas pendaftaran/RM wajar membuka banyak rekam medis. Perlu ambang per peran.
- `P05` · Kontak keluarga/penanggung jawab (`patient_contacts`) menyusul bersama registrasi (F03). Persetujuan privasi baru tersedia lewat API; layarnya dibuat bersama Registrasi (fase 2).
- `P05` · Rotasi kunci `FIELD_ENCRYPTION_KEY`/`FIELD_HASH_KEY` belum ada (perlu enkripsi ulang + hash ulang; format `v1` siap untuk versi berikutnya).
- `packages/db` · FK ke `patients` dari relasi/akses darurat masih `NOT VALID`; jalankan `VALIDATE CONSTRAINT` setelah basis data lokal/tes dibuat ulang.
- `P05` · Usulan pasangan manual (mis. pasien IGD tanpa identitas yang dikenali keluarga, skenario 5 mockup) belum ada; deteksi hanya otomatis.
- `P05` · Penggabungan belum dikirim ke SATUSEHAT (Patient link) lewat outbox; menyusul konektor SATUSEHAT (fase 7).
- `P05` · Query riwayat klinis (fase 2–3) wajib membaca kelompok rekam medis (`app_patient_group`), bukan satu `patient_id`.
- `P05` · Antrean MPI menampilkan maks. 50 terbuka + 50 keputusan 30 hari terakhir tanpa paginasi; kemiripan alamat masih sederhana (normalisasi + trigram).
- `packages/db` · Basis data uji lama masih berisi pasien RSFA terenkripsi dengan kunci uji (dari tes sebelum perbaikan); aman karena deteksi melewati data tak terbaca, bersih setelah `pnpm db:test:recreate`.
- `P05` · Pesan outbox Dukcapil yang masuk DLQ belum bisa dikirim ulang dari layar (Integration Hub, fase 7); verifikasi ulang manual lewat API sudah ada.
- `apps/worker` · Uji BullMQ (Redis) memproses semua tenant di `simrs_test`, termasuk pesan Dukcapil sisa tes API yang akan masuk DLQ karena stub uji; tidak memengaruhi hasil tes.
- `P06` · Belum ada: SNOMED CT, daftar agama/pekerjaan, daftar singkatan baku dan terlarang (katalog P06); izin `ref.write` (admin RS) belum dipakai, disiapkan untuk daftar lokal per RS.
- `P06` · Dataset resmi (ICD-10/ICD-9-CM Kemenkes, LOINC dengan lisensi, KFA, wilayah Kemendagri) harus diimpor operator; belum ada layar impor dan riwayat versi per kode.
