-- Fase 3 · potongan 3.5 · eMAR + asuhan keperawatan (K12): verifikasi dua identitas saat gelang tidak terbaca,
-- implementasi/evaluasi askep, dan diagnosa awal penjaminan BPJS dari registrasi (dipakai ulang SEP rawat inap).
-- Bagian tengah dibangkitkan prisma migrate diff; bawah manual. NO FORCE sementara pada tabel yang dirujuk FK baru,
-- dikembalikan di akhir berkas.
ALTER TABLE "patients" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "encounters" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "users" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "nursing_care_plans" NO FORCE ROW LEVEL SECURITY;

-- AlterTable
ALTER TABLE "coverages" ADD COLUMN     "initial_diagnosis_code" TEXT,
ADD COLUMN     "initial_diagnosis_display" TEXT;

-- AlterTable
ALTER TABLE "wristband_scans" ADD COLUMN     "method" TEXT NOT NULL DEFAULT 'scan',
ADD COLUMN     "override_reason" TEXT;

-- CreateTable
CREATE TABLE "nursing_care_activities" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "encounter_id" UUID NOT NULL,
    "care_plan_root_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "outcome" TEXT,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id" UUID NOT NULL,
    "user_role" TEXT NOT NULL,

    CONSTRAINT "nursing_care_activities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "nursing_care_activities_tenant_id_care_plan_root_id_idx" ON "nursing_care_activities"("tenant_id", "care_plan_root_id");

-- CreateIndex
CREATE INDEX "nursing_care_activities_tenant_id_encounter_id_idx" ON "nursing_care_activities"("tenant_id", "encounter_id");

-- CreateIndex
CREATE UNIQUE INDEX "nursing_care_activities_tenant_id_id_key" ON "nursing_care_activities"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "nursing_care_activities" ADD CONSTRAINT "nursing_care_activities_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nursing_care_activities" ADD CONSTRAINT "nursing_care_activities_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nursing_care_activities" ADD CONSTRAINT "nursing_care_activities_tenant_id_encounter_id_fkey" FOREIGN KEY ("tenant_id", "encounter_id") REFERENCES "encounters"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nursing_care_activities" ADD CONSTRAINT "nursing_care_activities_tenant_id_care_plan_root_id_fkey" FOREIGN KEY ("tenant_id", "care_plan_root_id") REFERENCES "nursing_care_plans"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nursing_care_activities" ADD CONSTRAINT "nursing_care_activities_tenant_id_user_id_fkey" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================
-- Diagnosa awal penjaminan BPJS (utang 3.3): disalin dari isian registrasi, tidak diubah sesudahnya.
-- =====================================================================
ALTER TABLE "coverages" ADD CONSTRAINT coverages_initial_diagnosis_valid CHECK (
  (initial_diagnosis_code IS NULL) = (initial_diagnosis_display IS NULL)
  AND (initial_diagnosis_code IS NULL OR initial_diagnosis_code ~ '^[A-Z][0-9]{2}(\.[0-9]{1,2})?$')
  AND (initial_diagnosis_display IS NULL OR char_length(initial_diagnosis_display) BETWEEN 1 AND 200));

-- =====================================================================
-- Pindaian gelang: verifikasi dua identitas (gelang rusak/tidak terbaca). Tetap baris pindaian bertanggal server yang
-- menunjuk gelang aktif kunjungan ini; server lebih dulu mencocokkan nama + tanggal lahir/RM. Wajib alasan ≥ 10.
-- =====================================================================
ALTER TABLE "wristband_scans" ADD CONSTRAINT wristband_scans_method_valid CHECK (
  method IN ('scan', 'dua_identitas')
  AND (method = 'scan') = (override_reason IS NULL)
  AND (override_reason IS NULL OR char_length(btrim(override_reason)) BETWEEN 10 AND 500));

CREATE OR REPLACE FUNCTION app_wristband_scan_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  NEW.scanned_at := statement_timestamp();
  IF NEW.wristband_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM patient_wristbands w
       WHERE w.tenant_id = NEW.tenant_id AND w.id = NEW.wristband_id AND w.encounter_id = NEW.encounter_id
         AND w.patient_id = NEW.patient_id AND w.voided_at IS NULL
         AND (NEW.method = 'dua_identitas' OR w.code = NEW.scanned_code)) THEN
    RAISE EXCEPTION 'WRISTBAND_MISMATCH: gelang tidak cocok dengan kunjungan ini' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $fn$;

-- =====================================================================
-- Implementasi/evaluasi askep: append-only, atas rantai rencana kunjungan yang sama.
-- =====================================================================
ALTER TABLE "nursing_care_activities" ADD CONSTRAINT nursing_care_activities_values_valid CHECK (
  kind IN ('implementasi', 'evaluasi')
  AND char_length(btrim(text)) BETWEEN 1 AND 2000
  AND (kind = 'evaluasi') = (outcome IS NOT NULL)
  AND (outcome IS NULL OR outcome IN ('teratasi', 'teratasi_sebagian', 'belum_teratasi'))
  AND user_role ~ '^[a-z][a-z0-9_]{2,40}$'
  AND occurred_at <= recorded_at + interval '5 minutes');

CREATE FUNCTION app_nursing_care_activity_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  NEW.recorded_at := statement_timestamp();
  IF NOT EXISTS (
       SELECT 1 FROM nursing_care_plans p
       WHERE p.tenant_id = NEW.tenant_id AND p.id = NEW.care_plan_root_id AND p.root_id = p.id
         AND p.encounter_id = NEW.encounter_id AND p.patient_id = NEW.patient_id) THEN
    RAISE EXCEPTION 'CLINICAL_CHAIN: rencana asuhan bukan milik kunjungan ini' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER nursing_care_activities_guard BEFORE INSERT ON "nursing_care_activities"
  FOR EACH ROW EXECUTE FUNCTION app_nursing_care_activity_guard();
CREATE TRIGGER nursing_care_activities_append_only BEFORE UPDATE OR DELETE ON "nursing_care_activities"
  FOR EACH ROW EXECUTE FUNCTION app_reject_mutation();

ALTER TABLE "nursing_care_activities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "nursing_care_activities" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "nursing_care_activities"
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'simrs_app') THEN
    GRANT SELECT, INSERT ON "nursing_care_activities" TO simrs_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON "nursing_care_activities" FROM simrs_app;
  END IF;
END $do$;

ALTER TABLE "patients" FORCE ROW LEVEL SECURITY;
ALTER TABLE "encounters" FORCE ROW LEVEL SECURITY;
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;
ALTER TABLE "nursing_care_plans" FORCE ROW LEVEL SECURITY;
