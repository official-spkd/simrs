-- Dijalankan sekali saat volume Postgres pertama kali dibuat (database: simrs, user: postgres).
-- Kata sandi di bawah KHUSUS LOKAL dan harus sama dengan .env.example.

CREATE ROLE simrs_migrator LOGIN CREATEDB PASSWORD 'migrator_local';  -- CREATEDB: shadow database Prisma migrate dev
CREATE ROLE simrs_app LOGIN PASSWORD 'app_local' NOSUPERUSER NOBYPASSRLS;

ALTER DATABASE simrs OWNER TO simrs_migrator;
ALTER SCHEMA public OWNER TO simrs_migrator;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS btree_gin;

-- Skema data rujukan global (ICD, LOINC, KFA, wilayah): read-only bagi aplikasi.
CREATE SCHEMA IF NOT EXISTS ref AUTHORIZATION simrs_migrator;

GRANT CONNECT ON DATABASE simrs TO simrs_app;
GRANT USAGE ON SCHEMA public, ref TO simrs_app;

-- Hak default untuk objek yang dibuat migrator ke depan.
ALTER DEFAULT PRIVILEGES FOR ROLE simrs_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO simrs_app;
ALTER DEFAULT PRIVILEGES FOR ROLE simrs_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO simrs_app;
ALTER DEFAULT PRIVILEGES FOR ROLE simrs_migrator IN SCHEMA ref
  GRANT SELECT ON TABLES TO simrs_app;

-- Database terpisah untuk tes integrasi (dibersihkan per run oleh test harness).
CREATE DATABASE simrs_test OWNER simrs_migrator;

-- Catatan untuk migrasi Prisma (fase 0):
-- * Setiap tabel domain: ALTER TABLE <t> ENABLE ROW LEVEL SECURITY; ALTER TABLE <t> FORCE ROW LEVEL SECURITY;
--   CREATE POLICY tenant_isolation ON <t> USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
--   WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
-- * Tabel klinis append-only & audit_events: REVOKE UPDATE, DELETE ON <t> FROM simrs_app;
