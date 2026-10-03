# PROGRESS

Diperbarui oleh Claude Code di akhir setiap potongan kerja. Format: centang kriteria, catat keputusan, utang teknis, dan langkah berikutnya.

## Status fase

| Fase | Nama                               | Status                                                                                |
| ---- | ---------------------------------- | ------------------------------------------------------------------------------------- |
| 0    | Fondasi repo dan infrastruktur     | 🟨 hampir selesai: tinggal tes BullMQ + `/ready` hijau (butuh Redis/MinIO via Docker) |
| 1    | Platform inti                      | ⬜                                                                                    |
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

## Langkah berikutnya

- Setelah Docker hidup: `pnpm infra:up` → `pnpm test` (tes BullMQ harus hijau) → `/ready` hijau → centang dua kriteria sisa → fase 0 ✅.
- Fase 1 (P01 → P02 → P03 → P04 → P05 …) dengan rencana yang disetujui dulu. P02/P03 juga menggantikan gerbang sementara area superadmin dengan peran `superadmin_platform` (ADR-0010) dan tenant dari header dengan klaim token.

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

## Utang teknis

- `apps/web` · menu sidebar memakai data statis; hitungan (antrean, IGD) dan status integrasi akan diisi dari API (fase 2 & 7).
- `apps/mock` · state di memori (hilang saat restart); cukup untuk lokal.
- `apps/api` · `HealthService` memakai endpoint kesehatan khusus MinIO; ganti dengan HeadBucket bila memakai S3 lain.
- `packages/db` · seed hanya 2 tenant; staf dan pasien fiktif menyusul di fase 1.
- `apps/web` · CSP masih `'unsafe-inline'` untuk skrip (hidrasi Next tanpa nonce); pindah ke CSP ber-nonce di hardening fase 10.
- `apps/api` · rate limit per IP di memori per instans; pindah ke penyimpanan Redis + batas per pengguna saat P02, dan set `trust proxy` saat di belakang load balancer.
- `apps/worker` · dispatcher mengirim berurutan per tenant; paralelkan terbatas bila volume naik (fase 7).
