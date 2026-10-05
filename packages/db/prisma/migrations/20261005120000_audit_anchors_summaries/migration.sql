-- Fase 10 · 10.8 · P04: jangkar hash audit + titik periksa + ringkasan harian temuan anomali (ADR-0072).
-- Tabel/kolom/indeks identik dengan schema.prisma; batasan, trigger, RLS, hak akses, dan fungsi di bagian bawah.

-- CreateTable
CREATE TABLE "audit_anchors" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "seq" BIGINT NOT NULL,
    "hash" TEXT NOT NULL,
    "anchored_at" TIMESTAMPTZ(3) NOT NULL,
    "key_id" TEXT NOT NULL,
    "hmac" TEXT NOT NULL,
    "object_key" TEXT,
    "source" TEXT NOT NULL DEFAULT 'job',
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_anchors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_daily_summaries" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "day" DATE NOT NULL,
    "params_key" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "event_count" INTEGER NOT NULL,
    "item_count" INTEGER NOT NULL,
    "computed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_daily_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_daily_summary_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "summary_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "actor_user_id" UUID,
    "actor_role" TEXT,
    "n" INTEGER NOT NULL,
    "last_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "audit_daily_summary_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "audit_anchors_tenant_id_seq_key" ON "audit_anchors"("tenant_id", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "audit_daily_summaries_tenant_id_day_params_key_key" ON "audit_daily_summaries"("tenant_id", "day", "params_key");

-- CreateIndex
CREATE UNIQUE INDEX "audit_daily_summaries_tenant_id_id_key" ON "audit_daily_summaries"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "audit_daily_summary_items_tenant_id_summary_id_kind_idx" ON "audit_daily_summary_items"("tenant_id", "summary_id", "kind");

-- AddForeignKey
ALTER TABLE "audit_anchors" ADD CONSTRAINT "audit_anchors_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_daily_summaries" ADD CONSTRAINT "audit_daily_summaries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_daily_summary_items" ADD CONSTRAINT "audit_daily_summary_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_daily_summary_items" ADD CONSTRAINT "audit_daily_summary_items_tenant_id_summary_id_fkey" FOREIGN KEY ("tenant_id", "summary_id") REFERENCES "audit_daily_summaries"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- =====================================================================
-- Batasan
-- =====================================================================
ALTER TABLE "audit_anchors" ADD CONSTRAINT audit_anchors_format CHECK (
  seq > 0
  AND hash ~ '^[0-9a-f]{64}$'
  AND hmac ~ '^[0-9a-f]{64}$'
  AND key_id ~ '^[0-9a-f]{16}$'
  AND source IN ('job', 'worm'));
-- Satu seq = satu objek WORM dengan kunci yang bisa diturunkan (tidak bisa menunjuk objek lain).
ALTER TABLE "audit_anchors" ADD CONSTRAINT audit_anchors_object_key CHECK (
  object_key IS NULL
  OR object_key = 'audit-anchors/' || tenant_id::text || '/' || lpad(seq::text, 20, '0') || '.json');

ALTER TABLE "audit_daily_summaries" ADD CONSTRAINT audit_daily_summaries_format CHECK (
  params_key ~ '^[0-9a-f]{64}$' AND event_count >= 0 AND item_count >= 0);
ALTER TABLE "audit_daily_summary_items" ADD CONSTRAINT audit_daily_summary_items_format CHECK (
  kind IN ('login_failed', 'access_denied', 'night', 'volume') AND n > 0);

-- =====================================================================
-- Waktu catat jangkar dari jam database; jangkar tidak boleh bertanggal masa depan.
-- =====================================================================
CREATE OR REPLACE FUNCTION app_audit_anchor_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.recorded_at := date_trunc('milliseconds', clock_timestamp());
  IF NEW.anchored_at > NEW.recorded_at + interval '1 minute' THEN
    RAISE EXCEPTION 'AUDIT_ANCHOR_FUTURE: waktu jangkar di masa depan' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER audit_anchors_guard
  BEFORE INSERT ON "audit_anchors"
  FOR EACH ROW EXECUTE FUNCTION app_audit_anchor_guard();

-- Append-only (ADR-0004/0072): jangkar dan ringkasan tidak diubah/dihapus siapa pun lewat aplikasi.
CREATE TRIGGER audit_anchors_append_only
  BEFORE UPDATE OR DELETE ON "audit_anchors"
  FOR EACH ROW EXECUTE FUNCTION app_reject_mutation();
CREATE TRIGGER audit_daily_summaries_append_only
  BEFORE UPDATE OR DELETE ON "audit_daily_summaries"
  FOR EACH ROW EXECUTE FUNCTION app_reject_mutation();
CREATE TRIGGER audit_daily_summary_items_append_only
  BEFORE UPDATE OR DELETE ON "audit_daily_summary_items"
  FOR EACH ROW EXECUTE FUNCTION app_reject_mutation();

-- =====================================================================
-- RLS + hak akses: baca dan sisip saja (tanpa ubah/hapus/truncate).
-- =====================================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['audit_anchors', 'audit_daily_summaries', 'audit_daily_summary_items'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())',
      t);
  END LOOP;
END $$;

-- =====================================================================
-- Verifikasi rantai mulai dari titik periksa (jangkar sah). Tanpa argumen = seluruh rantai (sama dengan
-- app_verify_audit_chain). Dengan (p_seq, p_hash): baris p_seq harus ada, hash tersimpan = p_hash dan cocok bila
-- dihitung ulang; baris sesudahnya harus bersambung. Mengembalikan juga baris terakhir yang lolos (kepala yang
-- terverifikasi), dipakai job jangkar agar yang dijangkar persis yang diperiksa.
-- =====================================================================
CREATE OR REPLACE FUNCTION app_verify_audit_chain_from(p_seq bigint DEFAULT NULL, p_hash text DEFAULT NULL)
RETURNS TABLE (checked bigint, first_broken_seq bigint, last_seq bigint, last_hash text)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  r audit_events;
  expected_seq bigint := COALESCE(p_seq, 1);
  expected_prev text := NULL;
  at_checkpoint boolean := p_seq IS NOT NULL;
  n bigint := 0;
BEGIN
  last_seq := NULL;
  last_hash := NULL;
  FOR r IN SELECT * FROM audit_events
           WHERE tenant_id = app_current_tenant() AND seq >= COALESCE(p_seq, 1)
           ORDER BY seq LOOP
    n := n + 1;
    IF r.seq <> expected_seq
       OR (at_checkpoint AND r.hash IS DISTINCT FROM p_hash)
       OR (NOT at_checkpoint AND r.prev_hash IS DISTINCT FROM expected_prev)
       OR r.hash IS DISTINCT FROM app_audit_hash(r) THEN
      checked := n;
      first_broken_seq := r.seq;
      RETURN NEXT;
      RETURN;
    END IF;
    at_checkpoint := false;
    expected_seq := expected_seq + 1;
    expected_prev := r.hash;
    last_seq := r.seq;
    last_hash := r.hash;
  END LOOP;
  checked := n;
  -- Titik periksa yang barisnya sudah tidak ada = rusak di titik itu.
  first_broken_seq := CASE WHEN p_seq IS NOT NULL AND n = 0 THEN p_seq END;
  RETURN NEXT;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'simrs_app') THEN
    GRANT SELECT, INSERT ON "audit_anchors", "audit_daily_summaries", "audit_daily_summary_items" TO simrs_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON "audit_anchors", "audit_daily_summaries", "audit_daily_summary_items" FROM simrs_app;
    GRANT EXECUTE ON FUNCTION app_verify_audit_chain_from(bigint, text) TO simrs_app;
  END IF;
END $$;
