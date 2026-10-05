# ADR-0008 · Konteks tenant wajib di DB dan worker lintas tenant tanpa BYPASSRLS

Status: diterima · 3 Okt 2026 · diperbarui 5 Okt 2026

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

## Pembaruan 5 Okt 2026 · daftar fungsi SECURITY DEFINER

Aturan di atas ("setiap fungsi `SECURITY DEFINER` baru ditinjau dan dicatat di ADR") ditinjau ulang 5 Okt 2026. Semua fungsi memakai `search_path` berakhiran `pg_temp` (diperbaiki migrasi `20261005150000` dan `20261005163000`, dijaga `schema-guard.test.ts`); fungsi yang menembus RLS hanya mengembalikan data minimum.

| Fungsi | Migrasi | ADR | Hak `EXECUTE` | Yang dikembalikan / ditulis |
| --- | --- | --- | --- | --- |
| `app_active_tenant_ids()` | `20261003000000_fondasi` | 0008 | `simrs_app` (worker) | ID tenant aktif |
| `app_resolve_tenant_by_code(text)`, `app_resolve_tenant_by_host(text)` | `20261004020000_iam` | 0011 | `simrs_app` (login) | ID + jenis tenant |
| `app_sync_patient_name()` (trigger), `app_search_patient_names(text)` | `20261005090000_patient_name_search_index` | 0015 | trigger; `simrs_app` | indeks nama tenant aktif; ID pasien |
| `app_record_backup_run(…)`, `app_record_restore_test(…)` | `20261005110000_backup_runs` | 0071 | hanya `simrs_backup` | satu baris catatan di tenant PLATFORM |
| `app_backup_status()` | `20261005110000_backup_runs` | 0071 | `simrs_app` | waktu + status per lokasi, jumlah gagal 24 jam, uji restore (tanpa lokasi, kunci, ukuran, galat) |
| `app_rekey_patient_identifier(…)`, `app_rekey_patient_link(…)`, `app_rekey_patient_contact(…)`, `app_rekey_coverage_member(…)` | `20261005130000`, `20261005131000`, `20261005210000` | 0015 | `simrs_app` (job rotasi) | tulis ulang satu baris tenant aktif (RLS), compare-and-swap, versi kunci wajib berganti |
| `app_key_rotation_tenant_ids()` | `20261005130000_field_key_rotation` | 0015 | `simrs_app` (job rotasi) | ID semua tenant, juga yang nonaktif |

`app_verify_audit_chain_from` (ADR-0072) sengaja **bukan** `SECURITY DEFINER`: verifikasi rantai berjalan di bawah RLS tenant pemanggil. Fungsi pencatat cadangan menyetel `app.tenant_id` lokal-transaksi ke tenant PLATFORM lalu mengembalikan konteks pemanggil; `simrs_backup` (BYPASSRLS) hanya dipakai alat cadangan di luar runtime aplikasi.
