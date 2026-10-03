-- Fase 0 · Fondasi data: tenants, outbox, delivery_attempts, inbound_events, audit_events.
-- Bagian atas: ekstensi + hak akses (idempoten, agar DB baru seperti simrs_test identik dengan simrs).
-- Bagian tengah: dibangkitkan `prisma migrate diff`. Bagian bawah: RLS, append-only, fungsi (manual, ADR-0002/0004/0008).

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS btree_gin;
CREATE SCHEMA IF NOT EXISTS ref;

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kemenkes_code" TEXT,
    "bpjs_ppk_code" TEXT,
    "satusehat_org_id" TEXT,
    "hospital_class" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_messages" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "target" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ(3),
    "dead_at" TIMESTAMPTZ(3),

    CONSTRAINT "outbox_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_attempts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "outbox_message_id" UUID NOT NULL,
    "attempt_no" INTEGER NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "status_code" INTEGER,
    "outcome" TEXT NOT NULL,
    "error" TEXT,
    "response_excerpt" TEXT,

    CONSTRAINT "delivery_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbound_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "headers" JSONB NOT NULL,
    "raw_body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'received',
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(3),
    "error" TEXT,

    CONSTRAINT "inbound_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_user_id" UUID,
    "actor_role" TEXT,
    "patient_id" UUID,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "ip" TEXT,
    "user_agent" TEXT,
    "request_id" TEXT,
    "prev_hash" TEXT,
    "hash" TEXT,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_code_key" ON "tenants"("code");

-- CreateIndex
CREATE INDEX "outbox_messages_tenant_id_status_next_attempt_at_idx" ON "outbox_messages"("tenant_id", "status", "next_attempt_at");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_messages_tenant_id_target_idempotency_key_key" ON "outbox_messages"("tenant_id", "target", "idempotency_key");

-- CreateIndex
CREATE INDEX "delivery_attempts_tenant_id_outbox_message_id_idx" ON "delivery_attempts"("tenant_id", "outbox_message_id");

-- CreateIndex
CREATE UNIQUE INDEX "inbound_events_tenant_id_source_idempotency_key_key" ON "inbound_events"("tenant_id", "source", "idempotency_key");

-- CreateIndex
CREATE INDEX "audit_events_tenant_id_occurred_at_idx" ON "audit_events"("tenant_id", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_events_tenant_id_patient_id_occurred_at_idx" ON "audit_events"("tenant_id", "patient_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "outbox_messages" ADD CONSTRAINT "outbox_messages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_attempts" ADD CONSTRAINT "delivery_attempts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_attempts" ADD CONSTRAINT "delivery_attempts_outbox_message_id_fkey" FOREIGN KEY ("outbox_message_id") REFERENCES "outbox_messages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_events" ADD CONSTRAINT "inbound_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- =====================================================================
-- Konteks tenant (ADR-0002, ADR-0008)
-- Query tanpa app.tenant_id GAGAL (bukan mengembalikan 0 baris) agar bug lupa konteks langsung ketahuan.
-- =====================================================================
CREATE OR REPLACE FUNCTION app_current_tenant() RETURNS uuid
LANGUAGE plpgsql STABLE AS $$
DECLARE v text := current_setting('app.tenant_id', true);
BEGIN
  IF v IS NULL OR v = '' THEN
    RAISE EXCEPTION 'TENANT_REQUIRED: app.tenant_id belum disetel untuk transaksi ini'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN v::uuid;
END $$;

-- tenants: satu-satunya tabel yang kolom kuncinya `id`, bukan `tenant_id`.
ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenants" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "tenants"
  USING (id = app_current_tenant()) WITH CHECK (id = app_current_tenant());

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['outbox_messages', 'delivery_attempts', 'inbound_events', 'audit_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())',
      t);
  END LOOP;
END $$;

-- Daftar tenant aktif untuk worker lintas tenant. Hanya mengembalikan ID; semua kerja data tetap lewat RLS (ADR-0008).
CREATE OR REPLACE FUNCTION app_active_tenant_ids() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM tenants WHERE status = 'active' ORDER BY id;
$$;
REVOKE ALL ON FUNCTION app_active_tenant_ids() FROM PUBLIC;

-- =====================================================================
-- Append-only (ADR-0004): audit_events tidak bisa diubah/dihapus siapa pun lewat aplikasi.
-- =====================================================================
CREATE OR REPLACE FUNCTION app_reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'APPEND_ONLY: % pada % tidak diizinkan', TG_OP, TG_TABLE_NAME USING ERRCODE = 'P0001';
END $$;

CREATE TRIGGER audit_events_append_only
  BEFORE UPDATE OR DELETE ON "audit_events"
  FOR EACH ROW EXECUTE FUNCTION app_reject_mutation();

-- =====================================================================
-- Hak akses role aplikasi (tanpa BYPASSRLS). Default privileges di init.sql hanya berlaku di DB simrs;
-- GRANT eksplisit di sini membuat DB lain (simrs_test) setara.
-- =====================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'simrs_app') THEN
    GRANT USAGE ON SCHEMA public, ref TO simrs_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "tenants", "outbox_messages", "delivery_attempts", "inbound_events" TO simrs_app;
    GRANT SELECT, INSERT ON "audit_events" TO simrs_app;
    REVOKE UPDATE, DELETE ON "audit_events" FROM simrs_app;
    REVOKE DELETE ON "tenants" FROM simrs_app;
    GRANT EXECUTE ON FUNCTION app_current_tenant() TO simrs_app;
    GRANT EXECUTE ON FUNCTION app_active_tenant_ids() TO simrs_app;
  END IF;
END $$;
