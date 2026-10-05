-- Fase 2 · event domain tersimpan (usulan peninjau S dan P, disetujui 5 Okt 2026). `DomainEvents.publish()` menyisipkan
-- satu baris per event di transaksi penerbit SEBELUM penangan berjalan, sehingga event ikut commit/batal bersama
-- perubahan asalnya dan bisa ditelusuri (siapa, kapan, permintaan mana). Payload hanya ID dan nilai enum (tanpa PHI;
-- dijaga penerbit + CHECK bentuk). Bagian tengah dibangkitkan `prisma migrate diff`; bawah manual.
-- Tanpa NO FORCE: FK baru hanya ke `tenants` (registri tanpa FORCE).

-- CreateTable
CREATE TABLE "domain_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "request_id" TEXT,
    "actor_user_id" UUID,
    "actor_device_id" UUID,

    CONSTRAINT "domain_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "domain_events_tenant_id_name_occurred_at_idx" ON "domain_events"("tenant_id", "name", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "domain_events_tenant_id_id_key" ON "domain_events"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "domain_events" ADD CONSTRAINT "domain_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================
-- Batasan domain
-- =====================================================================
ALTER TABLE "domain_events" ADD CONSTRAINT domain_events_name_format
  CHECK (name ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$' AND char_length(name) <= 80);
-- Payload = objek datar: nilai skalar (ID, enum, angka, boolean, null) atau larik ID; tidak ada objek bersarang
-- tempat data bebas bisa disisipkan. Mode `strict`: mode lax membuka larik bersarang sehingga [[…]] lolos.
ALTER TABLE "domain_events" ADD CONSTRAINT domain_events_payload_flat CHECK (
  jsonb_typeof(payload) = 'object'
  AND NOT jsonb_path_exists(payload, 'strict $.* ? (@.type() == "object")')
  AND NOT jsonb_path_exists(payload, 'strict $.* ? (@.type() == "array")[*] ? (@.type() == "object" || @.type() == "array")'));
ALTER TABLE "domain_events" ADD CONSTRAINT domain_events_request_id_length
  CHECK (request_id IS NULL OR char_length(request_id) <= 100);

-- Append-only (ADR-0004): event yang terjadi tidak diubah atau dihapus, juga oleh pemilik tabel.
CREATE TRIGGER domain_events_append_only BEFORE UPDATE OR DELETE ON "domain_events"
  FOR EACH ROW EXECUTE FUNCTION app_reject_mutation();

-- =====================================================================
-- RLS
-- =====================================================================
ALTER TABLE "domain_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "domain_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "domain_events"
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

-- =====================================================================
-- Hak akses: sisip + baca saja (default privileges DB `simrs` memberi UPDATE/DELETE, dicabut eksplisit).
-- =====================================================================
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'simrs_app') THEN
    GRANT SELECT, INSERT ON "domain_events" TO simrs_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON "domain_events" FROM simrs_app;
  END IF;
END $do$;
