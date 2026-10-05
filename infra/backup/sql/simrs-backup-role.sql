-- Peran ops backup `simrs_backup` (ADR-0071) untuk cluster Postgres yang SUDAH ada. Volume baru mendapatkannya dari
-- infra/postgres/init.sql. Jalankan sebagai superuser, sekali per database yang di-backup (idempoten):
--
--   docker compose exec -T postgres psql -U postgres -d simrs -v backup_password=backup_local \
--     -f - < infra/backup/sql/simrs-backup-role.sql
--
-- Produksi: jangan pakai -v backup_password; setel kata sandi interaktif (`\password simrs_backup`) atau pakai
-- autentikasi sertifikat. Peran ini hanya untuk kontainer/host ops backup, tidak pernah untuk aplikasi.

-- 1. Peran (global cluster): baca semua data + BYPASSRLS (pg_dump butuh semua baris tenant), tanpa hak tulis.
SELECT 'CREATE ROLE simrs_backup LOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 4'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'simrs_backup') \gexec
ALTER ROLE simrs_backup LOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION INHERIT CONNECTION LIMIT 4;
-- Setiap transaksi baca-saja kecuali dibuka eksplisit READ WRITE (hanya untuk memanggil fungsi pencatat).
ALTER ROLE simrs_backup SET default_transaction_read_only = on;
GRANT pg_read_all_data TO simrs_backup;

\if :{?backup_password}
SELECT format('ALTER ROLE simrs_backup PASSWORD %L', :'backup_password') \gexec
\endif

-- 2. Database ini: fungsi pencatat hasil (bila migrasi 20261005110000 sudah diterapkan sebelum peran ada).
SELECT format('GRANT EXECUTE ON FUNCTION %s TO simrs_backup', p.oid::regprocedure)
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname IN ('app_record_backup_run', 'app_record_restore_test') \gexec
