# SIM RS · Starter Kit untuk Claude Code

Repo awal untuk membangun **SIM RS multi-RS (SaaS, deployment hibrida)** bersama Claude Code, dimulai dari **localhost**.
Isi repo ini belum berupa aplikasi jadi. Repo ini berisi semua bahan yang dibutuhkan Claude Code untuk membangunnya fase demi fase tanpa menebak:

| Bahan | Lokasi |
|---|---|
| Aturan kerja proyek untuk Claude Code | `CLAUDE.md`, `.claude/` |
| Arsitektur, data model, keamanan | `docs/01`–`docs/05` |
| 81 komponen dalam 7 lapisan (kode P/F/K/S/U/B/I) | `docs/02-katalog-komponen.md` |
| Bedah KMK 1596/2024 (51 EP MRMIK) | `docs/03-regulasi-mrmik.md` |
| Integrasi BPJS, SATUSEHAT, E-Klaim, Dukcapil | `docs/06-integrasi.md` |
| Pembayaran TPDI × BTN dan pembiayaan BTN | `docs/07-pembayaran-btn-tpdi.md` |
| Sistem desain dan peta layar | `docs/08-desain-ui.md`, `design/` |
| Rencana fase + kriteria selesai | `docs/09-rencana-fase.md` |
| Prompt siap tempel untuk tiap fase | `docs/10-prompt-claude-code.md` |
| Persiapan Windows (WSL2, Docker, Node, Claude Code) | `docs/11-setup-windows.md` |
| Keputusan arsitektur (ADR) | `docs/adr/` |
| Papan progres yang diperbarui Claude Code | `docs/PROGRESS.md` |
| Infrastruktur lokal (Postgres, Redis, MinIO, Mailpit) | `docker-compose.yml`, `infra/` |

## Stack

- **Monorepo**: pnpm workspaces + Turborepo, TypeScript di semua lapisan.
- **API**: NestJS (REST + OpenAPI), Prisma, PostgreSQL 16 dengan Row-Level Security per tenant.
- **Worker**: NestJS standalone + BullMQ (Redis) untuk outbox integrasi, retry, dan job terjadwal.
- **Web staf, anjungan, display**: Next.js (App Router) + Tailwind dengan token desain "Klinis Bersih".
- **Aplikasi pasien & dokter**: Expo (React Native), mulai fase 9.
- **Mock integrasi**: satu layanan lokal yang meniru BPJS (VClaim, Antrean, Aplicare), E-Klaim, SATUSEHAT, Dukcapil, TTE, TPDI, dan BTN.
- **Infra lokal**: Docker Compose (Postgres, Redis, MinIO, Mailpit; HAPI FHIR opsional).

Alasan pilihan ada di `docs/adr/`.

## Mulai cepat (Windows)

1. Ikuti `docs/11-setup-windows.md` sekali saja (WSL2 Ubuntu, Docker Desktop, Git, Node 22, pnpm, Claude Code).
2. Di terminal Ubuntu (WSL):
   ```bash
   cd ~/proyek && unzip simrs-starter-kit.zip && cd simrs
   bash scripts/doctor.sh          # cek prasyarat
   cp .env.example .env
   docker compose up -d            # Postgres, Redis, MinIO, Mailpit
   git init && git add -A && git commit -m "chore: starter kit"
   claude                          # buka Claude Code di root repo
   ```
3. Di Claude Code, jalankan `/fase 0`. Setelah selesai dan lolos kriteria, lanjut `/fase 1`, dan seterusnya.
   Bila belum yakin, ketik `/lanjut`: Claude Code membaca `docs/PROGRESS.md` dan mengerjakan langkah berikutnya.

## Alamat lokal (setelah fase 0)

| Layanan | URL |
|---|---|
| Web staf | http://localhost:3000 |
| API + Swagger | http://localhost:4000 · http://localhost:4000/docs |
| Mock integrasi + panel kendali | http://localhost:4100 |
| Mailpit (email/OTP lokal) | http://localhost:8025 |
| MinIO console | http://localhost:9001 |
| Postgres | localhost:5432 |

## Prinsip yang tidak boleh dilanggar

1. **Data klinis tidak pernah dihapus atau ditimpa**: koreksi membuat versi baru dengan alasan (MRMIK 8).
2. **Setiap akses ke data pasien tercatat** di audit trail append-only (MRMIK 2.1, 10).
3. **Setiap baris data milik satu tenant**, dan isolasinya ditegakkan di database (RLS), bukan hanya di kode.
4. **Integrasi eksternal lewat outbox + retry**; transaksi klinis tidak boleh gagal karena BPJS/SATUSEHAT/bank sedang down.
5. **Uang pasien tidak pernah transit di TPDI**: TPDI mengorkestrasi, BTN memegang dana (ADR-0005).
6. **Lokal = data fiktif**. Jangan memasukkan data pasien asli ke lingkungan pengembangan.

## Catatan penting

- Spesifikasi API BPJS, SATUSEHAT, E-Klaim, TPDI, dan BTN di repo ini adalah **rangkuman untuk mock**. Sebelum integrasi nyata, cocokkan dengan dokumen resmi yang diterima RS/mitra (katalog API BPJS, dokumentasi SATUSEHAT, manual web service E-Klaim, spesifikasi API TPDI dan BTN).
- Angka tarif, margin, dan aturan selisih kelas di mock adalah **simulasi**.
- Mockup interaktif seluruh layar: https://claude.ai/artifact/68mwSh34uMk31GWyNDJfHj (salinan sumbernya ada di `design/mockups/`).
