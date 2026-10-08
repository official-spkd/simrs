-- Fase 4 potongan 4.5 · S04 farmasi klinis: temuan CDS saat telaah (per putaran evaluasi) dan tindak lanjut apoteker.
-- Append-only (juga bagi pemilik tabel), waktu dari server, RLS FORCE + tenant_isolation, role aplikasi SELECT/INSERT.

ALTER TABLE "users" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "pharmacy_prescriptions" NO FORCE ROW LEVEL SECURITY;

-- CreateTable
CREATE TABLE "pharmacy_cds_alerts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "pharmacy_prescription_id" UUID NOT NULL,
    "evaluation_id" UUID NOT NULL,
    "medication_request_ids" UUID[],
    "level" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "rule_code" TEXT NOT NULL,
    "rule_version" INTEGER,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "recommendation" TEXT,
    "prescriber_override" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pharmacy_cds_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pharmacy_cds_alert_decisions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "alert_id" UUID NOT NULL,
    "decision" TEXT NOT NULL,
    "reason" TEXT,
    "decided_by" UUID NOT NULL,
    "decided_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pharmacy_cds_alert_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pharmacy_cds_alerts_tenant_id_id_key" ON "pharmacy_cds_alerts"("tenant_id", "id");
CREATE INDEX "pharmacy_cds_alerts_tenant_id_pharmacy_prescription_id_crea_idx"
  ON "pharmacy_cds_alerts"("tenant_id", "pharmacy_prescription_id", "created_at");
CREATE UNIQUE INDEX "pharmacy_cds_alert_decisions_tenant_id_id_key" ON "pharmacy_cds_alert_decisions"("tenant_id", "id");
CREATE UNIQUE INDEX "pharmacy_cds_alert_decisions_tenant_id_alert_id_key"
  ON "pharmacy_cds_alert_decisions"("tenant_id", "alert_id");

-- AddForeignKey
ALTER TABLE "pharmacy_cds_alerts" ADD CONSTRAINT "pharmacy_cds_alerts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pharmacy_cds_alerts" ADD CONSTRAINT "pharmacy_cds_alerts_tenant_id_pharmacy_prescription_id_fkey" FOREIGN KEY ("tenant_id", "pharmacy_prescription_id") REFERENCES "pharmacy_prescriptions"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pharmacy_cds_alerts" ADD CONSTRAINT "pharmacy_cds_alerts_tenant_id_created_by_fkey" FOREIGN KEY ("tenant_id", "created_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pharmacy_cds_alert_decisions" ADD CONSTRAINT "pharmacy_cds_alert_decisions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pharmacy_cds_alert_decisions" ADD CONSTRAINT "pharmacy_cds_alert_decisions_tenant_id_alert_id_fkey" FOREIGN KEY ("tenant_id", "alert_id") REFERENCES "pharmacy_cds_alerts"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pharmacy_cds_alert_decisions" ADD CONSTRAINT "pharmacy_cds_alert_decisions_tenant_id_decided_by_fkey" FOREIGN KEY ("tenant_id", "decided_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Nilai sah
ALTER TABLE "pharmacy_cds_alerts" ADD CONSTRAINT pharmacy_cds_alerts_values_valid CHECK (
  level IN ('mayor', 'sedang', 'info')
  AND kind IN ('interaksi', 'dosis-ginjal', 'alergi', 'kontraindikasi', 'high-alert')
  AND char_length(btrim(title)) BETWEEN 1 AND 200 AND char_length(btrim(detail)) BETWEEN 1 AND 1000
  AND (NOT prescriber_override OR level = 'mayor'));
ALTER TABLE "pharmacy_cds_alert_decisions" ADD CONSTRAINT pharmacy_cds_alert_decisions_values_valid CHECK (
  decision IN ('konfirmasi', 'override', 'usul')
  AND (decision <> 'override' OR char_length(btrim(coalesce(reason, ''))) BETWEEN 10 AND 500)
  AND (reason IS NULL OR char_length(reason) <= 500));

-- RLS
ALTER TABLE "pharmacy_cds_alerts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pharmacy_cds_alerts" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "pharmacy_cds_alerts" USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
ALTER TABLE "pharmacy_cds_alert_decisions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pharmacy_cds_alert_decisions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "pharmacy_cds_alert_decisions" USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());

-- Append-only + waktu server
CREATE TRIGGER pharmacy_cds_alerts_append_only BEFORE UPDATE OR DELETE ON "pharmacy_cds_alerts"
  FOR EACH ROW EXECUTE FUNCTION app_reject_mutation();
CREATE TRIGGER pharmacy_cds_alert_decisions_append_only BEFORE UPDATE OR DELETE ON "pharmacy_cds_alert_decisions"
  FOR EACH ROW EXECUTE FUNCTION app_reject_mutation();
CREATE TRIGGER pharmacy_cds_alerts_server_time BEFORE INSERT ON "pharmacy_cds_alerts"
  FOR EACH ROW EXECUTE FUNCTION app_support_server_time('created_at');
CREATE TRIGGER pharmacy_cds_alert_decisions_server_time BEFORE INSERT ON "pharmacy_cds_alert_decisions"
  FOR EACH ROW EXECUTE FUNCTION app_support_server_time('decided_at');

-- Hak akses role aplikasi
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'simrs_app') THEN
    REVOKE ALL ON "pharmacy_cds_alerts", "pharmacy_cds_alert_decisions" FROM simrs_app;
    GRANT SELECT, INSERT ON "pharmacy_cds_alerts", "pharmacy_cds_alert_decisions" TO simrs_app;
  END IF;
END $do$;

ALTER TABLE "users" FORCE ROW LEVEL SECURITY;
ALTER TABLE "pharmacy_prescriptions" FORCE ROW LEVEL SECURITY;
