# ADR-0008 · Konteks tenant wajib di DB dan worker lintas tenant tanpa BYPASSRLS

Status: diterima · 3 Okt 2026

## Konteks

ADR-0002 menetapkan RLS dengan `current_setting('app.tenant_id')`. Dua hal belum diatur:

1. Kebijakan dengan `current_setting(..., true)` mengembalikan 0 baris bila konteks lupa disetel. Bug seperti itu diam-diam lolos, padahal Definisi selesai fase 0 menuntut "query tanpa `app.tenant_id` gagal".
2. Worker outbox harus memproses pesan semua tenant, padahal role `simrs_app` tidak boleh `BYPASSRLS` (CLAUDE.md §8).

## Keputusan

- Semua kebijakan RLS memanggil `app_current_tenant()`. Fungsi ini melempar `TENANT_REQUIRED` bila `app.tenant_id` kosong atau tidak disetel. Tabel `tenants` memakai kebijakan `id = app_current_tenant()`.
- Satu fungsi `SECURITY DEFINER` sempit, `app_active_tenant_ids()`, hanya mengembalikan ID tenant aktif. Worker memanggilnya, lalu memproses outbox per tenant di dalam `withTenant`, sehingga semua akses data tetap tunduk RLS.
- Tabel registri `tenants` memakai `ENABLE` tanpa `FORCE` RLS (migrasi `20261003010000`). Pemilik tabel (`simrs_migrator`, tidak dipakai saat runtime) dan fungsi di atas bisa membaca daftar tenant tanpa konteks. `simrs_app` tetap tunduk RLS. Semua tabel domain lain tetap `FORCE`.
- Klaim pesan outbox memakai `FOR UPDATE SKIP LOCKED` di dalam transaksi tenant, sehingga aman dijalankan beberapa worker.
- `audit_events`: `UPDATE`/`DELETE` dicabut dari `simrs_app` dan ditolak trigger `app_reject_mutation()` (ADR-0004).
- Migrasi menyertakan `CREATE EXTENSION IF NOT EXISTS` dan `GRANT` eksplisit, sehingga DB tes (`simrs_test`) setara dengan DB pengembangan. Default privileges di `init.sql` hanya berlaku di DB `simrs`.

## Konsekuensi

+ Lupa konteks tenant = galat keras di tes dan runtime, bukan kebocoran atau data hilang diam-diam.
+ Tidak ada role aplikasi dengan `BYPASSRLS`.
− Setiap fungsi `SECURITY DEFINER` baru wajib ditinjau keamanan dan dicatat di ADR. Fungsinya harus mengembalikan data seminimal mungkin.
