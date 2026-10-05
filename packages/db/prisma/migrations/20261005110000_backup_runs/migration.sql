-- Fase 10 · 10.7 Backup terenkripsi tiga lokasi + uji restore (ADR-0071).
-- backup_runs dan restore_tests = catatan operasional PLATFORM, bukan data RS: baris milik tenant platform,
-- RLS ENABLE + FORCE seperti tabel domain lain, append-only, dan hanya ditulis lewat fungsi SECURITY DEFINER sempit
-- yang EXECUTE-nya hanya untuk peran ops `simrs_backup` (bukan simrs_app). RS membaca ringkasan lewat
-- app_backup_status() (pola ADR-0008: tanpa lokasi, kunci, ukuran, atau teks galat).
-- Peran simrs_backup dibuat superuser (infra/postgres/init.sql, atau infra/backup/sql/simrs-backup-role.sql untuk
-- cluster yang sudah ada): migrator tidak punya CREATEROLE dan BYPASSRLS hanya bisa diberikan superuser.
-- Bagian tengah dibangkitkan prisma migrate diff; bagian bawah manual.

-- CreateTable
CREATE TABLE "backup_runs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "backup_key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "finished_at" TIMESTAMPTZ(3) NOT NULL,
    "locations_ok" TEXT[],
    "db_bytes" BIGINT,
    "documents_bytes" BIGINT,
    "document_files" INTEGER,
    "table_count" INTEGER,
    "row_total" BIGINT,
    "manifest_sha256" TEXT,
    "error" TEXT,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "backup_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "restore_tests" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "backup_key" TEXT,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "finished_at" TIMESTAMPTZ(3) NOT NULL,
    "rto_seconds" INTEGER NOT NULL,
    "checks" JSONB NOT NULL,
    "error" TEXT,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "restore_tests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "backup_runs_tenant_id_finished_at_idx" ON "backup_runs"("tenant_id", "finished_at");

-- CreateIndex
CREATE UNIQUE INDEX "backup_runs_tenant_id_backup_key_key" ON "backup_runs"("tenant_id", "backup_key");

-- CreateIndex
CREATE INDEX "restore_tests_tenant_id_finished_at_idx" ON "restore_tests"("tenant_id", "finished_at");

-- AddForeignKey
ALTER TABLE "backup_runs" ADD CONSTRAINT "backup_runs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restore_tests" ADD CONSTRAINT "restore_tests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- =====================================================================
-- Batasan domain
-- =====================================================================
ALTER TABLE "backup_runs" ADD CONSTRAINT backup_runs_kind_valid CHECK (kind IN ('hourly', 'daily', 'manual'));
ALTER TABLE "backup_runs" ADD CONSTRAINT backup_runs_status_valid CHECK (status IN ('success', 'partial', 'failed'));
-- Kunci = nama folder backup di ketiga lokasi: waktu mulai UTC + jenis.
ALTER TABLE "backup_runs" ADD CONSTRAINT backup_runs_key_format
  CHECK (backup_key ~ '^[0-9]{8}T[0-9]{6}Z-(hourly|daily|manual)$' AND backup_key LIKE '%-' || kind);
ALTER TABLE "backup_runs" ADD CONSTRAINT backup_runs_window CHECK (finished_at >= started_at);
ALTER TABLE "backup_runs" ADD CONSTRAINT backup_runs_locations_valid
  CHECK (locations_ok IS NOT NULL AND locations_ok <@ ARRAY['local', 'cloud', 'offsite']::text[]);
ALTER TABLE "backup_runs" ADD CONSTRAINT backup_runs_manifest_format
  CHECK (manifest_sha256 IS NULL OR manifest_sha256 ~ '^[a-f0-9]{64}$');
ALTER TABLE "backup_runs" ADD CONSTRAINT backup_runs_sizes_nonnegative CHECK (
  coalesce(db_bytes, 0) >= 0 AND coalesce(documents_bytes, 0) >= 0 AND coalesce(document_files, 0) >= 0
  AND coalesce(table_count, 0) >= 0 AND coalesce(row_total, 0) >= 0);
ALTER TABLE "backup_runs" ADD CONSTRAINT backup_runs_error_length
  CHECK (error IS NULL OR char_length(error) BETWEEN 1 AND 500);
-- success = manifest ada + ketiga lokasi; partial = backup ada di disk lokal, minimal satu lokasi jauh gagal;
-- partial/failed wajib menyebut galatnya.
ALTER TABLE "backup_runs" ADD CONSTRAINT backup_runs_status_consistent CHECK (
  (status = 'success' AND manifest_sha256 IS NOT NULL AND error IS NULL
     AND locations_ok @> ARRAY['local', 'cloud', 'offsite']::text[])
  OR (status = 'partial' AND manifest_sha256 IS NOT NULL AND error IS NOT NULL AND 'local' = ANY (locations_ok))
  OR (status = 'failed' AND error IS NOT NULL));

ALTER TABLE "restore_tests" ADD CONSTRAINT restore_tests_key_format
  CHECK (backup_key IS NULL OR backup_key ~ '^[0-9]{8}T[0-9]{6}Z-(hourly|daily|manual)$');
ALTER TABLE "restore_tests" ADD CONSTRAINT restore_tests_source_valid CHECK (source IN ('local', 'cloud', 'offsite'));
ALTER TABLE "restore_tests" ADD CONSTRAINT restore_tests_status_valid CHECK (status IN ('success', 'failed'));
ALTER TABLE "restore_tests" ADD CONSTRAINT restore_tests_window CHECK (finished_at >= started_at);
ALTER TABLE "restore_tests" ADD CONSTRAINT restore_tests_rto_nonnegative CHECK (rto_seconds >= 0);
ALTER TABLE "restore_tests" ADD CONSTRAINT restore_tests_checks_object
  CHECK (jsonb_typeof(checks) = 'object' AND pg_column_size(checks) <= 16384);
ALTER TABLE "restore_tests" ADD CONSTRAINT restore_tests_error_length
  CHECK (error IS NULL OR char_length(error) BETWEEN 1 AND 500);
ALTER TABLE "restore_tests" ADD CONSTRAINT restore_tests_status_consistent CHECK (
  (status = 'success' AND error IS NULL AND backup_key IS NOT NULL) OR (status = 'failed' AND error IS NOT NULL));

-- =====================================================================
-- RLS (tenant platform) + append-only (ADR-0004): tidak ada UPDATE/DELETE, termasuk oleh pemilik tabel.
-- =====================================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['backup_runs', 'restore_tests'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())',
      t);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION app_reject_mutation()',
      t || '_append_only', t);
  END LOOP;
END $$;

-- =====================================================================
-- Fungsi sempit. FORCE RLS berlaku juga bagi pemilik (definer), jadi fungsi menyetel konteks tenant platform
-- selama kerjanya lalu memulihkan konteks pemanggil. search_path diakhiri pg_temp agar tabel sementara pemanggil
-- tidak bisa membayangi tabel asli.
-- =====================================================================

-- Dicatat `pnpm backup:jalankan` (peran simrs_backup) setelah setiap run, berhasil atau tidak.
CREATE FUNCTION app_record_backup_run(
  p_id uuid,
  p_backup_key text,
  p_kind text,
  p_status text,
  p_started_at timestamptz,
  p_finished_at timestamptz,
  p_locations_ok text[],
  p_db_bytes bigint,
  p_documents_bytes bigint,
  p_document_files integer,
  p_table_count integer,
  p_row_total bigint,
  p_manifest_sha256 text,
  p_error text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_platform uuid;
  v_caller text := current_setting('app.tenant_id', true);
BEGIN
  SELECT t.id INTO v_platform FROM tenants t WHERE t.kind = 'platform';
  IF v_platform IS NULL THEN
    RAISE EXCEPTION 'PLATFORM_TENANT_REQUIRED: tenant platform belum dibuat' USING ERRCODE = 'P0001';
  END IF;
  PERFORM set_config('app.tenant_id', v_platform::text, true);
  INSERT INTO backup_runs (id, tenant_id, backup_key, kind, status, started_at, finished_at, locations_ok, db_bytes,
                           documents_bytes, document_files, table_count, row_total, manifest_sha256, error)
  VALUES (p_id, v_platform, p_backup_key, p_kind, p_status, p_started_at, p_finished_at, p_locations_ok, p_db_bytes,
          p_documents_bytes, p_document_files, p_table_count, p_row_total, p_manifest_sha256, p_error);
  PERFORM set_config('app.tenant_id', COALESCE(v_caller, ''), true);
  RETURN p_id;
END $fn$;

-- Dicatat `pnpm backup:uji-restore` ke database SUMBER (bukan ke DB hasil restore yang dibuang).
CREATE FUNCTION app_record_restore_test(
  p_id uuid,
  p_backup_key text,
  p_source text,
  p_status text,
  p_started_at timestamptz,
  p_finished_at timestamptz,
  p_rto_seconds integer,
  p_checks jsonb,
  p_error text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_platform uuid;
  v_caller text := current_setting('app.tenant_id', true);
BEGIN
  SELECT t.id INTO v_platform FROM tenants t WHERE t.kind = 'platform';
  IF v_platform IS NULL THEN
    RAISE EXCEPTION 'PLATFORM_TENANT_REQUIRED: tenant platform belum dibuat' USING ERRCODE = 'P0001';
  END IF;
  PERFORM set_config('app.tenant_id', v_platform::text, true);
  INSERT INTO restore_tests (id, tenant_id, backup_key, source, status, started_at, finished_at, rto_seconds, checks,
                             error)
  VALUES (p_id, v_platform, p_backup_key, p_source, p_status, p_started_at, p_finished_at, p_rto_seconds, p_checks,
          p_error);
  PERFORM set_config('app.tenant_id', COALESCE(v_caller, ''), true);
  RETURN p_id;
END $fn$;

-- Ringkasan untuk RS (layar Integrasi, kontrak `backups`): hanya waktu dan status. Tanpa nama bucket/path, kunci,
-- ukuran, jumlah baris, atau teks galat. Belum ada tenant platform/catatan → satu baris kosong.
CREATE FUNCTION app_backup_status()
RETURNS TABLE (
  last_run_at timestamptz,
  last_run_status text,
  last_success_at timestamptz,
  local_ok_at timestamptz,
  cloud_ok_at timestamptz,
  offsite_ok_at timestamptz,
  failed_last_24h integer,
  last_restore_test_at timestamptz,
  last_restore_test_status text,
  last_restore_rto_seconds integer
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_platform uuid;
  v_caller text := current_setting('app.tenant_id', true);
BEGIN
  failed_last_24h := 0;
  SELECT t.id INTO v_platform FROM tenants t WHERE t.kind = 'platform';
  IF v_platform IS NULL THEN
    RETURN NEXT;
    RETURN;
  END IF;
  PERFORM set_config('app.tenant_id', v_platform::text, true);
  SELECT b.finished_at, b.status INTO last_run_at, last_run_status
    FROM backup_runs b WHERE b.tenant_id = v_platform ORDER BY b.finished_at DESC, b.id DESC LIMIT 1;
  SELECT max(b.finished_at) FILTER (WHERE b.status = 'success'),
         max(b.finished_at) FILTER (WHERE 'local' = ANY (b.locations_ok)),
         max(b.finished_at) FILTER (WHERE 'cloud' = ANY (b.locations_ok)),
         max(b.finished_at) FILTER (WHERE 'offsite' = ANY (b.locations_ok)),
         count(*) FILTER (WHERE b.status <> 'success' AND b.finished_at > now() - interval '24 hours')
    INTO last_success_at, local_ok_at, cloud_ok_at, offsite_ok_at, failed_last_24h
    FROM backup_runs b WHERE b.tenant_id = v_platform;
  SELECT r.finished_at, r.status, r.rto_seconds
    INTO last_restore_test_at, last_restore_test_status, last_restore_rto_seconds
    FROM restore_tests r WHERE r.tenant_id = v_platform ORDER BY r.finished_at DESC, r.id DESC LIMIT 1;
  PERFORM set_config('app.tenant_id', COALESCE(v_caller, ''), true);
  RETURN NEXT;
END $fn$;

REVOKE ALL ON FUNCTION app_record_backup_run(uuid, text, text, text, timestamptz, timestamptz, text[], bigint, bigint,
  integer, integer, bigint, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_record_restore_test(uuid, text, text, text, timestamptz, timestamptz, integer, jsonb, text)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION app_backup_status() FROM PUBLIC;

-- =====================================================================
-- Hak akses. simrs_app: baca baris (RLS → hanya konteks tenant platform yang melihat isinya) + ringkasan; tidak bisa
-- menulis atau memanggil fungsi pencatat. simrs_backup (bila sudah ada): hanya fungsi pencatat; membacanya lewat
-- pg_read_all_data. Default privileges init.sql memberi simrs_app INSERT/UPDATE/DELETE di DB simrs → dicabut eksplisit.
-- =====================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'simrs_app') THEN
    GRANT SELECT ON "backup_runs", "restore_tests" TO simrs_app;
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON "backup_runs", "restore_tests" FROM simrs_app;
    GRANT EXECUTE ON FUNCTION app_backup_status() TO simrs_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'simrs_backup') THEN
    GRANT EXECUTE ON FUNCTION app_record_backup_run(uuid, text, text, text, timestamptz, timestamptz, text[], bigint,
      bigint, integer, integer, bigint, text, text) TO simrs_backup;
    GRANT EXECUTE ON FUNCTION app_record_restore_test(uuid, text, text, text, timestamptz, timestamptz, integer, jsonb,
      text) TO simrs_backup;
  END IF;
END $$;
