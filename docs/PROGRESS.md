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

| #   | Potongan                                                                                                                                                                | Status                                                          | Bukti                                                                                                                    |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 2   | P04 inti: transaksi per permintaan (`@TenantScoped`), `@Audited` di transaksi yang sama, hash berantai via trigger + verifikasi                                         | ✅                                                              | db 12 tes (paralel, waktu server, tamper), api 34 tes                                                                    |
| 1   | P01 struktur RS (faskes, unit, ruang→kamar→bed) + P08 penomoran + P10 modul aktif + P12 pengaturan                                                                      | ✅                                                              | db 20 tes (nomor paralel/batal, FK komposit, CHECK), api 44 tes; seed 12 unit + 5 kamar per RS                           |
| 3   | P02 identitas & login: argon2id, TOTP + anti-replay, sesi buram berotasi + deteksi pemakaian ulang, kunci akun, MFA wajib, subdomain/kode RS                            | ✅ (PIN perangkat & OTP cadangan email menyusul)                | shared 45 tes (vektor RFC 6238), api 61 tes (17 auth), diulang 2× stabil                                                 |
| 4   | P03 otorisasi: 16 peran + matriks per RS, penugasan per sesi, `@RequirePermission`, ABAC relasi pasien, break-the-glass + tinjauan, kelola pengguna                     | ✅ (laporan harian break-the-glass di potongan 6)               | db 24 tes (schema-guard), api 98 tes (37 otorisasi: 16 peran × aksi, relasi/darurat, race admin terakhir, anti-eskalasi) |
| 5a  | Layar Login (BFF cookie httpOnly, proxy pembaru sesi, MFA + QR, ganti sandi, pilih unit), tenant PLATFORM + `superadmin_platform`, CLI `db:create-admin`, `TRUST_PROXY` | ✅ (PIN perangkat, OTP cadangan, "percayai perangkat" menyusul) | api 106 tes, db 26, shared 51, web 24 unit + 40 E2E stack penuh (desktop + tablet)                                       |
| 5b  | Layar Akses (pengguna, penugasan, matriks izin)                                                                                                                         | ⬜                                                              |                                                                                                                          |
| 6   | Layar Audit + anomali                                                                                                                                                   | ⬜                                                              |                                                                                                                          |
| 7   | P05 MPI                                                                                                                                                                 | ⬜                                                              |                                                                                                                          |
| 8   | P06 master rujukan                                                                                                                                                      | ⬜                                                              |                                                                                                                          |
| 9   | P07 form engine + layar Formulir                                                                                                                                        | ⬜                                                              |                                                                                                                          |
| 10  | P09–P11 dokumen, TTE, notifikasi, seed staf                                                                                                                             | ⬜                                                              |                                                                                                                          |
| 11  | Penutup fase 1                                                                                                                                                          | ⬜                                                              |                                                                                                                          |

### Definisi selesai fase 1

- [x] Login + MFA berjalan; akun tanpa MFA tidak bisa membuka modul sensitif (API: sesi tanpa MFA hanya ke endpoint akun; web: akun baru wajib daftar MFA + ganti sandi sebelum halaman staf; diuji E2E)
- [x] Matriks izin: tes otomatis untuk ≥ 10 kombinasi peran × aksi × relasi (`apps/api/test/authz.test.ts`: 16 kombinasi peran × aksi + relasi aktif/berakhir + akses darurat)
- [ ] Setiap baca/ubah data pasien menghasilkan `audit_events`; hash berantai terverifikasi oleh tes. Hash berantai ✅ (P04); audit baca data pasien menunggu P05.
- [ ] Break-the-glass mencatat alasan dan muncul di laporan. Alasan tercatat di audit + daftar tinjauan petugas privasi (API) ✅; laporan di layar Audit (potongan 6).
- [ ] Merge MPI tidak menghapus apa pun dan bisa ditelusuri (P05, potongan 7)
- [ ] Koreksi form_response menghasilkan versi baru dengan alasan; diff tampil (P07, potongan 9)

## Langkah berikutnya

- Setelah Docker hidup: `pnpm infra:up` → `pnpm test` (tes BullMQ harus hijau) → `/ready` hijau → centang dua kriteria sisa → fase 0 ✅.
- Fase 1 potongan 5b: layar Akses (`/sistem/akses`): KPI, daftar pengguna (cari/filter), undang pengguna (sandi sementara sekali tampil), aksi reset/nonaktif, penugasan, editor matriks izin per peran.
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
- `P03` · `access_relationships` dan `break_glass_grants` belum ber-FK ke `patients` (tabel pasien dibuat P05); tambahkan FK komposit di potongan 7.
- `P03` · Lingkup `unit` belum memakai lokasi pasien (menunggu ADT fase 2–3); laporan harian break-the-glass (docs/05) dibuat bersama layar Audit (potongan 6).
- `P03` · Matriks izin dibaca dari DB tiap permintaan berizin; tambahkan cache per tenant + invalidasi bila beban naik.
- `P03` · Notifikasi baru tersimpan in-app; pengiriman email/WhatsApp menyusul P11 (potongan 10).
- `apps/web` · Peta refresh sesi di memori satu proses: web multi-instans butuh sticky session atau penyimpanan bersama (Redis) + `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` yang sama (ADR-0013).
- `apps/web` · Login: PIN perangkat terdaftar, OTP cadangan WhatsApp/email, dan "percayai perangkat 12 jam" dari mockup belum dibangun (P02/P11, potongan 10).
- `apps/web` · Pergantian unit kerja di tengah sesi belum ada (sekarang: keluar lalu masuk lagi).
- `scripts/with-pg.mjs` · Memuat seluruh `.env` root ke proses anak (termasuk `NODE_ENV=development`); E2E menimpa `NODE_ENV` untuk build web. Pertimbangkan daftar putih.
