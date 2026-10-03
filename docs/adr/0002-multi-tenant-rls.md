# ADR-0002 · Multi-tenant dengan kolom tenant_id + PostgreSQL RLS

Status: diterima · 3 Okt 2026

## Konteks

Platform SaaS untuk banyak RS. Kebocoran data antar-RS adalah risiko terbesar (UU PDP, MRMIK 10).

## Keputusan

Shared database/schema. Setiap tabel domain punya `tenant_id`. RLS aktif (`FORCE ROW LEVEL SECURITY`) dengan kebijakan `tenant_id = current_setting('app.tenant_id')::uuid`. Aplikasi memakai role `simrs_app` tanpa `BYPASSRLS`; setiap request dibungkus transaksi yang menyetel `app.tenant_id` (SET LOCAL). Migrasi memakai role `simrs_migrator`.

## Alternatif yang ditolak

- Database per tenant: isolasi kuat tetapi operasi, migrasi, dan analitik lintas RS mahal di awal. Bisa dipakai nanti untuk RS besar (opsi "dedicated") tanpa mengubah kode, karena kode tetap menyetel tenant.
- Schema per tenant: migrasi rumit dan tidak cocok dengan Prisma.

## Konsekuensi

Tes isolasi tenant wajib untuk setiap modul. Query tanpa konteks tenant gagal (bukan mengembalikan semua data).
