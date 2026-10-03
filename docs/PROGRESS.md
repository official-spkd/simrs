# PROGRESS

Diperbarui oleh Claude Code di akhir setiap potongan kerja. Format: centang kriteria, catat keputusan, utang teknis, dan langkah berikutnya.

## Status fase

| Fase | Nama                               | Status                                      |
| ---- | ---------------------------------- | ------------------------------------------- |
| 0    | Fondasi repo dan infrastruktur     | 🟨 berjalan (terhambat Docker, lihat bawah) |
| 1    | Platform inti                      | ⬜                                          |
| 2    | Front office                       | ⬜                                          |
| 3    | Klinis RME                         | ⬜                                          |
| 4    | Penunjang                          | ⬜                                          |
| 5    | Keuangan                           | ⬜                                          |
| 6    | Pembayaran TPDI × BTN + pembiayaan | ⬜                                          |
| 7    | Integration hub + SATUSEHAT        | ⬜                                          |
| 8    | Back office                        | ⬜                                          |
| 9    | Dasbor + aplikasi mobile           | ⬜                                          |
| 10   | Simulasi E2E, ketahanan, pilot     | ⬜                                          |

Legenda: ⬜ belum · 🟨 berjalan · ✅ selesai · ⛔ terhambat

## Fase 0 · potongan

| #   | Potongan                                                                                         | Status                                                               | Bukti                                                                |
| --- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 1   | Workspace pnpm + Turborepo + `packages/config`                                                   | ✅                                                                   | commit `chore(repo)`                                                 |
| 2   | `packages/shared` (uang bigint, tanggal WIB, galat, env, UUID v7, 81 komponen, kripto BPJS/TPDI) | ✅                                                                   | 15 tes unit                                                          |
| 3   | `packages/ui` + `apps/web` (AppShell, Sidebar, komponen dasar, `/dev/ui`)                        | ✅                                                                   | 6 tes komponen + 3 tes nav + build Next                              |
| 4   | `apps/mock` 7 sistem + panel kendali                                                             | ✅                                                                   | 12 tes (tanda tangan, enkripsi, skenario, webhook HMAC, idempotensi) |
| 5   | `packages/db` Prisma + RLS + `withTenant` + outbox                                               | 🟨 kode + build hijau; **tes RLS belum dijalankan** (butuh Postgres) | `test/rls.test.ts`                                                   |
| 6   | `apps/api` health/ready/Swagger/galat/request-id/tenancy                                         | 🟨 kode + build hijau; **tes integrasi belum dijalankan**            | `test/app.test.ts`                                                   |
| 7   | `apps/worker` outbox → mock, retry, DLQ (BullMQ)                                                 | 🟨 kode + build hijau; **tes integrasi belum dijalankan**            | `test/outbox.test.ts`                                                |
| 8   | Skrip root, Playwright smoke, README per aplikasi                                                | ✅                                                                   | 10 tes Playwright (Edge, desktop + tablet)                           |

### Definisi selesai fase 0

- [ ] `docker compose up -d` + `pnpm dev` menjalankan semua aplikasi tanpa galat. Web dan mock sudah jalan; API dan worker menunggu Postgres/Redis.
- [ ] `GET /ready` hijau (DB, Redis, MinIO)
- [ ] Tes membuktikan RLS: query tanpa `app.tenant_id` gagal; tenant A tidak melihat baris tenant B (tes ditulis, belum dijalankan)
- [ ] Pesan outbox contoh terkirim ke mock; bila mock diset gagal → retry → DLQ (tes ditulis, belum dijalankan)
- [x] `/dev/ui` menampilkan token dan komponen dasar sesuai Fondasi
- [x] README per aplikasi singkat; `PROGRESS.md` diperbarui

### Penghambat

- **Docker belum jalan**: firmware virtualisasi aktif, tetapi hypervisor Windows belum menyala. Perlu `wsl --install --no-distribution` (PowerShell Admin) lalu restart. Setelah itu: `pnpm infra:up`, `pnpm db:deploy`, `pnpm db:seed`, `pnpm test`.

## Langkah berikutnya

- Setelah Docker hidup: jalankan tes `packages/db`, `apps/api`, `apps/worker`; perbaiki bila merah; commit potongan 5–7; centang Definisi selesai.
- Lalu fase 1 (P01 → P02 → P03 → P04 → P05 …) dengan rencana yang disetujui dulu.

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

## Utang teknis

- `apps/web` · menu sidebar memakai data statis; hitungan (antrean, IGD) dan status integrasi akan diisi dari API (fase 2 & 7).
- `apps/mock` · state di memori (hilang saat restart); cukup untuk lokal.
- `apps/api` · `HealthService` memakai endpoint kesehatan khusus MinIO; ganti dengan HeadBucket bila memakai S3 lain.
- `packages/db` · seed hanya 2 tenant; staf dan pasien fiktif menyusul di fase 1.
