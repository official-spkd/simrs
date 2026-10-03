---
description: Kerjakan satu fase dari docs/09-rencana-fase.md secara bertahap
argument-hint: <nomor fase 0-10> [catatan tambahan]
---
Kerjakan **fase $ARGUMENTS** SIM RS.

1. Baca `CLAUDE.md`, `docs/PROGRESS.md`, dan bagian fase tersebut di `docs/09-rencana-fase.md`. Baca juga dokumen rujukan yang disebut fase itu (data model, keamanan, integrasi, pembayaran, desain) dan mockup layar terkait di `design/mockups/`.
2. Pastikan definisi selesai fase sebelumnya sudah hijau di `PROGRESS.md`. Bila belum, laporkan dan tanyakan apakah tetap lanjut.
3. Susun **rencana bertahap** (potongan kecil yang masing-masing bisa dites dan di-commit): file/modul yang dibuat, migrasi, endpoint, layar, tes. Tampilkan rencana dan tunggu persetujuan saya.
4. Setelah disetujui, kerjakan potongan demi potongan. Setelah tiap potongan: `pnpm lint && pnpm typecheck && pnpm test` hijau → commit (Conventional Commits, sebut kode komponen) → perbarui `docs/PROGRESS.md`.
5. Patuhi prinsip di `CLAUDE.md` bagian 4 tanpa kecuali. Bila dokumen tidak mengatur sesuatu, pilih opsi paling sederhana dan catat sebagai ADR baru.
6. Di akhir fase, jalankan checklist "Definisi selesai" dan laporkan: lolos, belum lolos (alasan), utang teknis, dan saran langkah berikutnya.
