# ADR-0009 · Postgres portabel untuk mesin tanpa Docker; persiapan tes non-destruktif

Status: diterima · 3 Okt 2026

## Konteks

1. Mesin pengembang belum bisa menjalankan Docker (virtualisasi/WSL2 belum aktif), padahal tes RLS, API, dan worker butuh PostgreSQL.
2. Persiapan tes awalnya memakai `prisma migrate reset --force` di setiap run. Prisma 7 menolak perintah itu bila dijalankan agen AI tanpa persetujuan eksplisit pengguna. Lebih penting lagi, tes yang bergantung pada penghapusan database adalah pola rapuh: satu salah konfigurasi URL bisa mengosongkan database yang salah.

## Keputusan

- Tambah dev dependency `embedded-postgres` (biner PostgreSQL 16.14 resmi, dikunci versinya) dan skrip `pnpm pg:portable`. Data di `.local/pg-data` (diabaikan git), hanya mendengar di 127.0.0.1, dan menjalankan `infra/postgres/init.sql` sekali sehingga role dan database identik dengan container Docker. Docker tetap jalur utama; Redis, MinIO, dan Mailpit tetap butuh Docker.
- Persiapan tes memakai `prepareTestDatabase()` dari `@simrs/db/testing`: `prisma migrate deploy` (hanya menerapkan migrasi tertunda) + upsert tenant fiktif. Tidak ada reset. Fungsi menolak database selain `simrs_test`. Prisma dipanggil lewat `node` langsung (tanpa shell).
- Setiap tes memakai ID/kunci unik dan tidak bergantung pada database kosong.
- Bila migrasi lama diubah dan checksum ditolak, manusia menjalankan `pnpm db:test:recreate -- --yes` secara sadar. Skrip ini hanya menyentuh `simrs_test`.

## Konsekuensi

+ Tes integrasi bisa berjalan di mesin tanpa Docker.
+ Tidak ada operasi destruktif otomatis di jalur tes.
− Database tes bertambah besar seiring waktu; buat ulang sesekali dengan perintah di atas.
− Postgres portabel tidak menggantikan Docker untuk Redis/MinIO; tes BullMQ tetap gagal (dengan pesan jelas) sampai Docker hidup.
