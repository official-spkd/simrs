# ADR-0007 · Pengembangan lokal langsung di Windows (tanpa WSL untuk kode)

Status: diterima · 3 Okt 2026

## Konteks

`docs/11-setup-windows.md` menyarankan kode dan Claude Code berjalan di WSL2 Ubuntu. Mesin pengembang saat ini menjalankan Claude Code di Windows (desktop app), dengan Node 24 dan Git for Windows. Virtualisasi belum aktif, sehingga Docker Desktop belum berjalan.

## Keputusan

- Kode, `pnpm`, dan Claude Code dijalankan langsung di Windows (repo di `C:\Users\Admin\SIM-RS\simrs-starter-kit\simrs`).
- pnpm diaktifkan lewat corepack ke direktori pengguna (`corepack enable --install-directory %APPDATA%\npm pnpm`) karena `C:\Program Files\nodejs` tidak bisa ditulis tanpa admin.
- Infra (Postgres, Redis, MinIO, Mailpit) tetap memakai `docker-compose.yml` lewat Docker Desktop setelah virtualisasi + WSL2 (`wsl --install --no-distribution`) diaktifkan. Distro Ubuntu tidak wajib.
- Skrip lintas platform ditulis di Node (bukan bash) bila harus jalan di Windows; skrip `.sh` lama tetap untuk WSL/Linux.
- Versi dikunci ke yang stabil dan saling cocok saat ini: TypeScript 6.0 (typescript-eslint belum mendukung TS 7), Prisma 7.10 (tag `latest` Prisma masih RC), NestJS 12, Next.js 16, Vitest 5.

## Konsekuensi

- Mulai tanpa restart mesin dan tanpa memindahkan repo.
  − File watcher dan I/O node_modules di NTFS sedikit lebih lambat dibanding filesystem Linux.
  − Bila nanti pindah ke WSL, cukup clone ulang repo; tidak ada kode yang bergantung pada Windows.
