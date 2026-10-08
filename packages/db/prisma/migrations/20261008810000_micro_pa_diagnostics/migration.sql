-- Fase 4 · 4.8 (ADR-0107): S02 laporan mikrobiologi per tahap ber-validasi dua tingkat (`micro_reports`), isolat
-- terkunci setelah tahapnya divalidasi; PA dengan gambar (dokumen P08); S10 laporan diagnostik lain di
-- `diagnostic_reports` (jenis, isian P07, lampiran); PA terhubung ke spesimen kamar operasi.

-- AlterTable
ALTER TABLE "diagnostic_reports" ADD COLUMN     "document_ids" UUID[] DEFAULT ARRAY[]::UUID[],
ADD COLUMN     "form_response_id" UUID,
ADD COLUMN     "kind" TEXT;

-- AlterTable
ALTER TABLE "pa_reports" ADD COLUMN     "image_document_ids" UUID[] DEFAULT ARRAY[]::UUID[],
ADD COLUMN     "surgery_specimen_id" UUID;

-- CreateTable
CREATE TABLE "micro_reports" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "lab_order_id" UUID NOT NULL,
    "stage" TEXT NOT NULL,
    "conclusion" TEXT NOT NULL,
    "technical_by" UUID NOT NULL,
    "technical_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clinical_by" UUID,
    "clinical_at" TIMESTAMPTZ(3),
    "document_id" UUID,

    CONSTRAINT "micro_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "micro_reports_tenant_id_id_key" ON "micro_reports"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "micro_reports_tenant_id_lab_order_id_stage_key" ON "micro_reports"("tenant_id", "lab_order_id", "stage");

-- FK komposit selama migrasi (FORCE dipulihkan di bawah).
ALTER TABLE "diagnostic_reports" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "documents" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "form_responses" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "lab_orders" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "users" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "surgery_specimens" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "pa_reports" NO FORCE ROW LEVEL SECURITY;

-- AddForeignKey
ALTER TABLE "diagnostic_reports" ADD CONSTRAINT "diagnostic_reports_tenant_id_form_response_id_fkey" FOREIGN KEY ("tenant_id", "form_response_id") REFERENCES "form_responses"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "micro_reports" ADD CONSTRAINT "micro_reports_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "micro_reports" ADD CONSTRAINT "micro_reports_tenant_id_lab_order_id_fkey" FOREIGN KEY ("tenant_id", "lab_order_id") REFERENCES "lab_orders"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "micro_reports" ADD CONSTRAINT "micro_reports_tenant_id_technical_by_fkey" FOREIGN KEY ("tenant_id", "technical_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "micro_reports" ADD CONSTRAINT "micro_reports_tenant_id_clinical_by_fkey" FOREIGN KEY ("tenant_id", "clinical_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "micro_reports" ADD CONSTRAINT "micro_reports_tenant_id_document_id_fkey" FOREIGN KEY ("tenant_id", "document_id") REFERENCES "documents"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pa_reports" ADD CONSTRAINT "pa_reports_tenant_id_surgery_specimen_id_fkey" FOREIGN KEY ("tenant_id", "surgery_specimen_id") REFERENCES "surgery_specimens"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "diagnostic_reports" FORCE ROW LEVEL SECURITY;
ALTER TABLE "documents" FORCE ROW LEVEL SECURITY;
ALTER TABLE "form_responses" FORCE ROW LEVEL SECURITY;
ALTER TABLE "lab_orders" FORCE ROW LEVEL SECURITY;
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;
ALTER TABLE "surgery_specimens" FORCE ROW LEVEL SECURITY;
ALTER TABLE "pa_reports" FORCE ROW LEVEL SECURITY;

ALTER TABLE "micro_reports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "micro_reports" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "micro_reports"
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

-- ---------------------------------------------------------------------
-- S02 · Laporan mikrobiologi per tahap: validasi teknis (baris dibuat) → rilis klinis oleh dokter LAIN (sekali, PDF
-- ber-TTE). Laporan akhir hanya setelah laporan awal dirilis. Setelah tahap divalidasi teknis, isolat/uji kepekaan
-- tahap itu terkunci (koreksi = laporan tahap berikutnya / addendum di luar potongan ini). Tidak dihapus.
-- ---------------------------------------------------------------------
ALTER TABLE "micro_reports" ADD CONSTRAINT micro_reports_values_valid CHECK (
  stage IN ('awal', 'akhir') AND char_length(btrim(conclusion)) BETWEEN 3 AND 2000
  AND (clinical_by IS NULL) = (clinical_at IS NULL)
  AND (document_id IS NULL OR clinical_by IS NOT NULL)
  AND (clinical_by IS NULL OR clinical_by <> technical_by));

CREATE FUNCTION app_micro_report_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'APPEND_ONLY: laporan mikrobiologi tidak dihapus' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.clinical_by IS NOT NULL OR NEW.document_id IS NOT NULL THEN
      RAISE EXCEPTION 'VALIDATION_ORDER: rilis klinis hanya setelah validasi teknis' USING ERRCODE = 'P0001';
    END IF;
    IF NEW.stage = 'akhir' AND NOT EXISTS (
         SELECT 1 FROM micro_reports r WHERE r.tenant_id = NEW.tenant_id AND r.lab_order_id = NEW.lab_order_id
           AND r.stage = 'awal' AND r.clinical_by IS NOT NULL) THEN
      RAISE EXCEPTION 'MICRO_STAGE_ORDER: laporan akhir hanya setelah laporan awal dirilis' USING ERRCODE = 'P0001';
    END IF;
    NEW.technical_at := statement_timestamp();
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.lab_order_id, NEW.stage, NEW.conclusion, NEW.technical_by, NEW.technical_at)
     IS DISTINCT FROM (OLD.id, OLD.lab_order_id, OLD.stage, OLD.conclusion, OLD.technical_by, OLD.technical_at)
     OR OLD.clinical_by IS NOT NULL OR NEW.clinical_by IS NULL THEN
    RAISE EXCEPTION 'APPEND_ONLY: laporan mikrobiologi dirilis sekali' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.clinical_by = OLD.technical_by THEN
    RAISE EXCEPTION 'VALIDATOR_SAME_USER: rilis klinis oleh dokter lain dari validator teknis' USING ERRCODE = 'P0001';
  END IF;
  NEW.clinical_at := statement_timestamp();
  RETURN NEW;
END $fn$;
CREATE TRIGGER micro_reports_guard BEFORE INSERT OR UPDATE OR DELETE ON "micro_reports"
  FOR EACH ROW EXECUTE FUNCTION app_micro_report_guard();

CREATE FUNCTION app_micro_isolate_open() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  st text;
  ord uuid;
BEGIN
  IF TG_TABLE_NAME = 'micro_susceptibilities' THEN
    SELECT i.stage, i.lab_order_id INTO st, ord FROM micro_isolates i
      WHERE i.tenant_id = NEW.tenant_id AND i.id = NEW.isolate_id;
    IF st IS DISTINCT FROM 'akhir' THEN
      RAISE EXCEPTION 'VALIDATION_FAILED: uji kepekaan hanya untuk isolat laporan akhir' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    st := NEW.stage;
    ord := NEW.lab_order_id;
  END IF;
  IF EXISTS (SELECT 1 FROM micro_reports r WHERE r.tenant_id = NEW.tenant_id AND r.lab_order_id = ord AND r.stage = st) THEN
    RAISE EXCEPTION 'MICRO_STAGE_CLOSED: tahap laporan ini sudah divalidasi; isolat terkunci' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER micro_isolates_open BEFORE INSERT ON "micro_isolates"
  FOR EACH ROW EXECUTE FUNCTION app_micro_isolate_open();
CREATE TRIGGER micro_susceptibilities_open BEFORE INSERT ON "micro_susceptibilities"
  FOR EACH ROW EXECUTE FUNCTION app_micro_isolate_open();

-- ---------------------------------------------------------------------
-- S10 · Laporan diagnostik lain di `diagnostic_reports` fase 3 (berversi, TTE ADR-0029): jenis + isian P07 + lampiran.
-- PA: gambar = dokumen pasien.
-- ---------------------------------------------------------------------
ALTER TABLE "diagnostic_reports" ADD CONSTRAINT diagnostic_reports_s10_valid CHECK (
  document_ids IS NOT NULL AND cardinality(document_ids) <= 20
  AND (kind IS NULL OR (kind IN ('ekg', 'usg', 'echo', 'endoskopi', 'treadmill') AND category = 'lainnya'))
  AND (form_response_id IS NULL OR kind IS NOT NULL));
ALTER TABLE "pa_reports" ADD CONSTRAINT pa_reports_images_valid CHECK (
  image_document_ids IS NOT NULL AND cardinality(image_document_ids) <= 20);

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'simrs_app') THEN
    REVOKE ALL ON "micro_reports" FROM simrs_app;
    GRANT SELECT, INSERT ON "micro_reports" TO simrs_app;
    GRANT UPDATE (clinical_by, clinical_at, document_id) ON "micro_reports" TO simrs_app;
  END IF;
END $do$;
