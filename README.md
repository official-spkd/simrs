# SIM RS

Sistem Informasi Manajemen Rumah Sakit **multi-RS (SaaS, deployment hibrida)**: satu platform untuk banyak rumah sakit, dengan isolasi data per RS ditegakkan di database. Dibangun bertahap dalam 11 fase; saat ini **fase 0 (fondasi)**.

> **Pengembang baru: mulai dari panduan.** Jalankan web lalu buka http://localhost:3000/superadmin/panduan, atau baca langsung berkasnya:
>
> 1. [Cara sistem bekerja](docs/panduan/01-cara-kerja-sistem.md): gambaran besar, multi-tenant, outbox, keamanan
> 2. [Cara kode bekerja](docs/panduan/02-cara-kerja-kode.md): struktur repo, alur permintaan, database, tes, konvensi
> 3. [Tutorial](docs/panduan/03-tutorial.md): menyiapkan mesin, menjalankan, membuat modul/layar/endpoint, pemecahan masalah

## Mulai cepat

Prasyarat: Node ≥ 24.7, Git, dan Docker Desktop (atau Postgres portabel, lihat Tutorial §1).

```bash
corepack enable                 # Windows tanpa admin: corepack enable --install-directory "%APPDATA%\npm" pnpm
pnpm install
pnpm env:init                   # .env dengan kunci enkripsi acak
pnpm doctor                     # cek prasyarat dan port

pnpm infra:up                   # Postgres, Redis, MinIO, Mailpit (Docker)
#   atau tanpa Docker:  pnpm pg:portable   (jendela terpisah; Postgres saja)

pnpm build                      # paket bersama
pnpm db:deploy && pnpm db:seed  # migrasi + 2 tenant RS fiktif
pnpm dev                        # api + worker + web + mock
#   tes tanpa Docker:  pnpm with-pg pnpm test
```

| Layanan                        | Alamat                                             |
| ------------------------------ | -------------------------------------------------- |
| Web staf                       | http://localhost:3000                              |
| Panduan superadmin             | http://localhost:3000/superadmin/panduan           |
| API · Swagger                  | http://127.0.0.1:4000 · http://127.0.0.1:4000/docs |
| Mock integrasi + panel kendali | http://127.0.0.1:4100                              |
| Mailpit                        | http://localhost:8025                              |
| MinIO console                  | http://localhost:9001 (atau `MINIO_CONSOLE_PORT`)  |

## Perintah harian

| Perintah                                     | Fungsi                                                       |
| -------------------------------------------- | ------------------------------------------------------------ |
| `pnpm dev`                                   | Semua aplikasi dalam mode watch                              |
| `pnpm lint` · `pnpm typecheck` · `pnpm test` | Wajib hijau sebelum commit                                   |
| `pnpm --filter @simrs/web test:e2e`          | Playwright (web harus jalan)                                 |
| `pnpm db:migrate`                            | Buat/terapkan migrasi (pengembangan)                         |
| `pnpm db:deploy` · `pnpm db:seed`            | Terapkan migrasi · isi data fiktif                           |
| `pnpm db:test:recreate -- --yes`             | Buat ulang database **tes** (destruktif, hanya `simrs_test`) |
| `pnpm doctor`                                | Periksa prasyarat                                            |
| `pnpm audit --prod`                          | Periksa kerentanan dependensi                                |

## Isi repo

| Bagian                                       | Lokasi                            |
| -------------------------------------------- | --------------------------------- |
| Aplikasi: API, worker, web, mock             | `apps/`                           |
| Paket bersama: shared, db, ui, config        | `packages/`                       |
| Panduan pengembang (juga tampil di aplikasi) | `docs/panduan/`                   |
| Arsitektur, data model, keamanan, integrasi  | `docs/01`–`docs/07`               |
| Desain UI + mockup acuan                     | `docs/08-desain-ui.md`, `design/` |
| Rencana fase + kriteria selesai              | `docs/09-rencana-fase.md`         |
| Status terkini, keputusan, utang teknis      | `docs/PROGRESS.md`                |
| Keputusan arsitektur                         | `docs/adr/`                       |
| Aturan kerja untuk Claude Code               | `CLAUDE.md`, `.claude/`           |

## Stack

pnpm + Turborepo · TypeScript 6 · Node 24 · NestJS 12 (API, worker) · Prisma 7 + PostgreSQL 16 dengan Row-Level Security · BullMQ + Redis · Next.js 16 + Tailwind 4 · Fastify 5 (mock) · Vitest 5 + Playwright. Alasan pemilihan ada di ADR-0001 dan ADR-0007.

## Prinsip yang tidak boleh dilanggar

1. **Setiap baris data milik satu tenant**, dan isolasinya ditegakkan database (RLS). Query tanpa konteks tenant gagal.
2. **Data klinis tidak dihapus atau ditimpa**: koreksi membuat versi baru dengan alasan.
3. **Setiap akses ke data pasien tercatat** di audit trail append-only.
4. **Integrasi eksternal lewat outbox + retry + idempotency**; layanan klinis tidak boleh berhenti karena BPJS/SATUSEHAT/bank gangguan.
5. **Uang = `bigint` rupiah**; uang pasien tidak transit di TPDI (ADR-0005).
6. **Lokal = data fiktif**; rahasia hanya di `.env`; fitur pengembangan mati bila `APP_ENV` bukan `local`/`staging`.

Daftar lengkap ada di `CLAUDE.md` §4. Daftar periksa keamanan per perubahan ada di [Cara kode bekerja](docs/panduan/02-cara-kerja-kode.md#daftar-periksa-keamanan-per-perubahan).

## Catatan

- Kontrak API BPJS, SATUSEHAT, E-Klaim, TPDI, dan BTN di repo ini adalah **rangkuman untuk mock**. Cocokkan dengan dokumen resmi sebelum integrasi nyata.
- Angka tarif, margin, dan kode CBG di mock adalah **simulasi**.
- Mockup interaktif seluruh layar: https://claude.ai/artifact/68mwSh34uMk31GWyNDJfHj (sumber di `design/mockups/`).
