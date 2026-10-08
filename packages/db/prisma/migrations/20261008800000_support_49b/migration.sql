-- Fase 4 · 4.9b (ADR-0106). Melengkapi 4.9:
-- - nilai kritis bersumber reaksi transfusi berat (`critical_results.transfusion_reaction_id`);
-- - pembatalan permintaan darah beralasan; pemusnahan kantong dua petugas (`blood_unit_disposals`);
-- - gizi: puasa (`diet_npo_orders`), skrining MST (`nutrition_screenings`), verifikasi order diet oleh ahli gizi, dan
--   gerbang layanan makan (order aktif terverifikasi, tanpa puasa aktif).

-- AlterTable
ALTER TABLE "blood_requests" ADD COLUMN     "cancel_reason" TEXT,
ADD COLUMN     "cancelled_at" TIMESTAMPTZ(3),
ADD COLUMN     "cancelled_by" UUID;

-- AlterTable
ALTER TABLE "critical_results" ADD COLUMN     "transfusion_reaction_id" UUID;

-- AlterTable
ALTER TABLE "diet_orders" ADD COLUMN     "verified_at" TIMESTAMPTZ(3),
ADD COLUMN     "verified_by" UUID;

-- CreateTable
CREATE TABLE "blood_unit_disposals" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "blood_unit_id" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "requested_by" UUID NOT NULL,
    "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_by" UUID,
    "confirmed_at" TIMESTAMPTZ(3),

    CONSTRAINT "blood_unit_disposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "diet_npo_orders" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "encounter_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "planned_until" TIMESTAMPTZ(3),
    "ordered_by" UUID NOT NULL,
    "ordered_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lifted_by" UUID,
    "lifted_at" TIMESTAMPTZ(3),

    CONSTRAINT "diet_npo_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nutrition_screenings" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "encounter_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "weight_loss" TEXT NOT NULL,
    "poor_appetite" BOOLEAN NOT NULL,
    "score" INTEGER NOT NULL,
    "at_risk" BOOLEAN NOT NULL,
    "screened_by" UUID NOT NULL,
    "screened_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nutrition_screenings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "blood_unit_disposals_tenant_id_id_key" ON "blood_unit_disposals"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "blood_unit_disposals_tenant_id_blood_unit_id_key" ON "blood_unit_disposals"("tenant_id", "blood_unit_id");

-- CreateIndex
CREATE INDEX "diet_npo_orders_tenant_id_encounter_id_idx" ON "diet_npo_orders"("tenant_id", "encounter_id");

-- CreateIndex
CREATE UNIQUE INDEX "diet_npo_orders_tenant_id_id_key" ON "diet_npo_orders"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "nutrition_screenings_tenant_id_encounter_id_screened_at_idx" ON "nutrition_screenings"("tenant_id", "encounter_id", "screened_at");

-- CreateIndex
CREATE UNIQUE INDEX "nutrition_screenings_tenant_id_id_key" ON "nutrition_screenings"("tenant_id", "id");

-- FK komposit selama migrasi (FORCE dipulihkan di bawah).
ALTER TABLE "blood_requests" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "blood_units" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "critical_results" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "diet_orders" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "encounters" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "patients" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "transfusion_reactions" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "users" NO FORCE ROW LEVEL SECURITY;

-- AddForeignKey
ALTER TABLE "critical_results" ADD CONSTRAINT "critical_results_tenant_id_transfusion_reaction_id_fkey" FOREIGN KEY ("tenant_id", "transfusion_reaction_id") REFERENCES "transfusion_reactions"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diet_orders" ADD CONSTRAINT "diet_orders_tenant_id_verified_by_fkey" FOREIGN KEY ("tenant_id", "verified_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blood_requests" ADD CONSTRAINT "blood_requests_tenant_id_cancelled_by_fkey" FOREIGN KEY ("tenant_id", "cancelled_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blood_unit_disposals" ADD CONSTRAINT "blood_unit_disposals_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blood_unit_disposals" ADD CONSTRAINT "blood_unit_disposals_tenant_id_blood_unit_id_fkey" FOREIGN KEY ("tenant_id", "blood_unit_id") REFERENCES "blood_units"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blood_unit_disposals" ADD CONSTRAINT "blood_unit_disposals_tenant_id_requested_by_fkey" FOREIGN KEY ("tenant_id", "requested_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blood_unit_disposals" ADD CONSTRAINT "blood_unit_disposals_tenant_id_confirmed_by_fkey" FOREIGN KEY ("tenant_id", "confirmed_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diet_npo_orders" ADD CONSTRAINT "diet_npo_orders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diet_npo_orders" ADD CONSTRAINT "diet_npo_orders_tenant_id_encounter_id_fkey" FOREIGN KEY ("tenant_id", "encounter_id") REFERENCES "encounters"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diet_npo_orders" ADD CONSTRAINT "diet_npo_orders_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diet_npo_orders" ADD CONSTRAINT "diet_npo_orders_tenant_id_ordered_by_fkey" FOREIGN KEY ("tenant_id", "ordered_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diet_npo_orders" ADD CONSTRAINT "diet_npo_orders_tenant_id_lifted_by_fkey" FOREIGN KEY ("tenant_id", "lifted_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutrition_screenings" ADD CONSTRAINT "nutrition_screenings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutrition_screenings" ADD CONSTRAINT "nutrition_screenings_tenant_id_encounter_id_fkey" FOREIGN KEY ("tenant_id", "encounter_id") REFERENCES "encounters"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutrition_screenings" ADD CONSTRAINT "nutrition_screenings_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutrition_screenings" ADD CONSTRAINT "nutrition_screenings_tenant_id_screened_by_fkey" FOREIGN KEY ("tenant_id", "screened_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "blood_requests" FORCE ROW LEVEL SECURITY;
ALTER TABLE "blood_units" FORCE ROW LEVEL SECURITY;
ALTER TABLE "critical_results" FORCE ROW LEVEL SECURITY;
ALTER TABLE "diet_orders" FORCE ROW LEVEL SECURITY;
ALTER TABLE "encounters" FORCE ROW LEVEL SECURITY;
ALTER TABLE "patients" FORCE ROW LEVEL SECURITY;
ALTER TABLE "transfusion_reactions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;

DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['blood_unit_disposals', 'diet_npo_orders', 'nutrition_screenings'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) '
      || 'WITH CHECK (tenant_id = app_current_tenant())', t);
  END LOOP;
END $do$;

-- ---------------------------------------------------------------------
-- S09 · Nilai kritis bersumber reaksi transfusi berat (satu per laporan reaksi).
-- ---------------------------------------------------------------------
ALTER TABLE "critical_results" DROP CONSTRAINT critical_results_values_valid;
ALTER TABLE "critical_results" ADD CONSTRAINT critical_results_values_valid CHECK (
  source IN ('lab', 'radiology', 'transfusion') AND status IN ('terbuka', 'dilaporkan') AND limit_minutes BETWEEN 1 AND 1440
  AND ((source = 'lab') = (lab_result_id IS NOT NULL))
  AND ((source = 'radiology') = (imaging_report_id IS NOT NULL))
  AND ((source = 'transfusion') = (transfusion_reaction_id IS NOT NULL)));
CREATE UNIQUE INDEX critical_results_one_per_transfusion_reaction ON "critical_results" (tenant_id, transfusion_reaction_id)
  WHERE transfusion_reaction_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- S08 · Pembatalan permintaan darah beralasan (hanya dari diminta/diproses; waktu server). Baris lama tidak divalidasi.
-- ---------------------------------------------------------------------
ALTER TABLE "blood_requests" ADD CONSTRAINT blood_requests_cancel_valid CHECK (
  (cancel_reason IS NULL) = (cancelled_at IS NULL) AND (cancelled_at IS NULL) = (cancelled_by IS NULL)
  AND (cancel_reason IS NULL OR char_length(btrim(cancel_reason)) BETWEEN 10 AND 500)
  AND ((status = 'batal') = (cancel_reason IS NOT NULL))) NOT VALID;

CREATE FUNCTION app_blood_request_cancel_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.cancel_reason IS DISTINCT FROM OLD.cancel_reason OR NEW.cancelled_by IS DISTINCT FROM OLD.cancelled_by
     OR NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at OR (NEW.status = 'batal' AND OLD.status <> 'batal') THEN
    IF OLD.status NOT IN ('diminta', 'diproses') OR OLD.cancel_reason IS NOT NULL OR NEW.status <> 'batal' THEN
      RAISE EXCEPTION 'BLOOD_REQUEST_CLOSED: permintaan sudah selesai atau batal' USING ERRCODE = 'P0001';
    END IF;
    NEW.cancelled_at := statement_timestamp();
  ELSIF OLD.status IN ('selesai', 'batal') AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'BLOOD_REQUEST_CLOSED: permintaan sudah selesai atau batal' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER blood_requests_cancel_guard BEFORE UPDATE ON "blood_requests"
  FOR EACH ROW EXECUTE FUNCTION app_blood_request_cancel_guard();

-- Cek ganda (ADR-0105) + 4.9b: permintaan masih aktif, kantong tidak sedang diajukan dimusnahkan.
CREATE OR REPLACE FUNCTION app_blood_issue_double_check() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  c record;
BEGIN
  SELECT * INTO c FROM blood_issue_checks WHERE tenant_id = NEW.tenant_id AND id = NEW.issue_check_id;
  IF c.id IS NULL OR c.blood_request_id <> NEW.blood_request_id OR c.blood_unit_id <> NEW.blood_unit_id
     OR c.emergency_reason IS DISTINCT FROM NEW.emergency_reason
     OR c.checked_at < statement_timestamp() - interval '30 minutes' THEN
    RAISE EXCEPTION 'BLOOD_DOUBLE_CHECK_REQUIRED: cek ganda pertama tidak ada, tidak cocok, atau kedaluwarsa'
      USING ERRCODE = 'P0001';
  END IF;
  IF c.checked_by = NEW.issued_by THEN
    RAISE EXCEPTION 'BLOOD_SECOND_CHECKER_SAME: petugas kedua harus orang lain' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM blood_requests r WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.blood_request_id
                   AND r.status IN ('diminta', 'diproses')) THEN
    RAISE EXCEPTION 'BLOOD_REQUEST_CLOSED: permintaan sudah selesai atau batal' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM blood_unit_disposals d WHERE d.tenant_id = NEW.tenant_id AND d.blood_unit_id = NEW.blood_unit_id) THEN
    RAISE EXCEPTION 'BLOOD_UNIT_UNAVAILABLE: kantong sedang/sudah dimusnahkan' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $fn$;

-- ---------------------------------------------------------------------
-- S08 · Pemusnahan kantong: dua petugas (sesi masing-masing), beralasan; kedaluwarsa hanya bila ED sudah lewat. Konfirmasi
-- petugas kedua mengubah kantong menjadi `dimusnahkan` di transaksi yang sama. Tidak dihapus.
-- ---------------------------------------------------------------------
ALTER TABLE "blood_unit_disposals" ADD CONSTRAINT blood_unit_disposals_values_valid CHECK (
  category IN ('kedaluwarsa', 'rusak') AND char_length(btrim(reason)) BETWEEN 10 AND 500
  AND (confirmed_by IS NULL) = (confirmed_at IS NULL)
  AND (confirmed_by IS NULL OR confirmed_by <> requested_by));

CREATE FUNCTION app_blood_unit_disposal_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  u record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'APPEND_ONLY: pemusnahan kantong tidak dihapus' USING ERRCODE = 'P0001';
  END IF;
  SELECT status, expires_at INTO u FROM blood_units WHERE tenant_id = NEW.tenant_id AND id = NEW.blood_unit_id FOR UPDATE;
  IF TG_OP = 'INSERT' THEN
    IF u.status IS NULL OR u.status IN ('dikeluarkan', 'dimusnahkan') OR NEW.confirmed_by IS NOT NULL THEN
      RAISE EXCEPTION 'BLOOD_UNIT_UNAVAILABLE: kantong sudah keluar atau dimusnahkan' USING ERRCODE = 'P0001';
    END IF;
    IF NEW.category = 'kedaluwarsa' AND u.expires_at > statement_timestamp() THEN
      RAISE EXCEPTION 'VALIDATION_FAILED: kantong belum kedaluwarsa; pilih kategori rusak' USING ERRCODE = 'P0001';
    END IF;
    NEW.requested_at := statement_timestamp();
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.blood_unit_id, NEW.category, NEW.reason, NEW.requested_by, NEW.requested_at)
     IS DISTINCT FROM (OLD.id, OLD.blood_unit_id, OLD.category, OLD.reason, OLD.requested_by, OLD.requested_at)
     OR OLD.confirmed_by IS NOT NULL OR NEW.confirmed_by IS NULL THEN
    RAISE EXCEPTION 'APPEND_ONLY: pemusnahan hanya dikonfirmasi sekali' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.confirmed_by = OLD.requested_by THEN
    RAISE EXCEPTION 'BLOOD_SECOND_CHECKER_SAME: konfirmasi oleh petugas kedua' USING ERRCODE = 'P0001';
  END IF;
  IF u.status IN ('dikeluarkan', 'dimusnahkan') THEN
    RAISE EXCEPTION 'BLOOD_UNIT_UNAVAILABLE: kantong sudah keluar atau dimusnahkan' USING ERRCODE = 'P0001';
  END IF;
  NEW.confirmed_at := statement_timestamp();
  UPDATE blood_units SET status = 'dimusnahkan', updated_at = statement_timestamp()
    WHERE tenant_id = NEW.tenant_id AND id = NEW.blood_unit_id;
  RETURN NEW;
END $fn$;
CREATE TRIGGER blood_unit_disposals_guard BEFORE INSERT OR UPDATE OR DELETE ON "blood_unit_disposals"
  FOR EACH ROW EXECUTE FUNCTION app_blood_unit_disposal_guard();

-- ---------------------------------------------------------------------
-- S07 · Puasa (NPO): satu aktif per kunjungan, dicabut sekali, tidak dihapus. Skrining MST: skor dihitung ulang CHECK.
-- Verifikasi order diet butuh skrining kunjungan itu. Layanan makan hanya untuk order aktif terverifikasi tanpa puasa.
-- ---------------------------------------------------------------------
ALTER TABLE "diet_npo_orders" ADD CONSTRAINT diet_npo_orders_values_valid CHECK (
  char_length(btrim(reason)) BETWEEN 10 AND 500 AND (lifted_by IS NULL) = (lifted_at IS NULL));
CREATE UNIQUE INDEX diet_npo_orders_one_active ON "diet_npo_orders" (tenant_id, encounter_id) WHERE lifted_at IS NULL;

CREATE FUNCTION app_diet_npo_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'APPEND_ONLY: order puasa tidak dihapus; cabut puasa' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.lifted_by IS NOT NULL THEN
      RAISE EXCEPTION 'VALIDATION_FAILED: puasa baru belum dicabut' USING ERRCODE = 'P0001';
    END IF;
    NEW.ordered_at := statement_timestamp();
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.encounter_id, NEW.patient_id, NEW.reason, NEW.planned_until, NEW.ordered_by, NEW.ordered_at)
     IS DISTINCT FROM (OLD.id, OLD.encounter_id, OLD.patient_id, OLD.reason, OLD.planned_until, OLD.ordered_by, OLD.ordered_at)
     OR OLD.lifted_at IS NOT NULL OR NEW.lifted_by IS NULL THEN
    RAISE EXCEPTION 'APPEND_ONLY: puasa hanya dicabut sekali' USING ERRCODE = 'P0001';
  END IF;
  NEW.lifted_at := statement_timestamp();
  RETURN NEW;
END $fn$;
CREATE TRIGGER diet_npo_orders_guard BEFORE INSERT OR UPDATE OR DELETE ON "diet_npo_orders"
  FOR EACH ROW EXECUTE FUNCTION app_diet_npo_guard();

ALTER TABLE "nutrition_screenings" ADD CONSTRAINT nutrition_screenings_values_valid CHECK (
  weight_loss IN ('tidak', 'tidak_yakin', '1_5', '6_10', '11_15', 'lebih_15')
  AND score = (CASE weight_loss WHEN 'tidak' THEN 0 WHEN 'tidak_yakin' THEN 2 WHEN '1_5' THEN 1 WHEN '6_10' THEN 2
                 WHEN '11_15' THEN 3 ELSE 4 END) + (CASE WHEN poor_appetite THEN 1 ELSE 0 END)
  AND at_risk = (score >= 2));
CREATE TRIGGER nutrition_screenings_append_only BEFORE UPDATE OR DELETE ON "nutrition_screenings"
  FOR EACH ROW EXECUTE FUNCTION app_reject_mutation();
CREATE TRIGGER nutrition_screenings_server_time BEFORE INSERT ON "nutrition_screenings"
  FOR EACH ROW EXECUTE FUNCTION app_support_server_time('screened_at');

ALTER TABLE "diet_orders" ADD CONSTRAINT diet_orders_verified_valid CHECK ((verified_by IS NULL) = (verified_at IS NULL));

CREATE FUNCTION app_diet_order_verify_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF (NEW.verified_by, NEW.verified_at) IS DISTINCT FROM (OLD.verified_by, OLD.verified_at) THEN
    IF OLD.verified_by IS NOT NULL OR NEW.verified_by IS NULL OR OLD.status <> 'aktif' THEN
      RAISE EXCEPTION 'DIET_VERIFIED: order diet sudah diverifikasi atau tidak aktif' USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM nutrition_screenings s WHERE s.tenant_id = NEW.tenant_id AND s.encounter_id = NEW.encounter_id) THEN
      RAISE EXCEPTION 'NUTRITION_SCREENING_REQUIRED: skrining gizi (MST) dulu' USING ERRCODE = 'P0001';
    END IF;
    NEW.verified_at := statement_timestamp();
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER diet_orders_verify_guard BEFORE UPDATE ON "diet_orders"
  FOR EACH ROW EXECUTE FUNCTION app_diet_order_verify_guard();

CREATE FUNCTION app_meal_service_gate() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  d record;
BEGIN
  SELECT status, verified_by, encounter_id INTO d FROM diet_orders WHERE tenant_id = NEW.tenant_id AND id = NEW.diet_order_id;
  IF d.status IS DISTINCT FROM 'aktif' THEN
    RAISE EXCEPTION 'VALIDATION_FAILED: order diet tidak aktif' USING ERRCODE = 'P0001';
  END IF;
  IF d.verified_by IS NULL THEN
    RAISE EXCEPTION 'DIET_NOT_VERIFIED: order diet belum diverifikasi ahli gizi' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM diet_npo_orders n WHERE n.tenant_id = NEW.tenant_id AND n.encounter_id = d.encounter_id
               AND n.lifted_at IS NULL) THEN
    RAISE EXCEPTION 'NPO_ACTIVE: pasien sedang puasa' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER meal_services_gate BEFORE INSERT ON "meal_services"
  FOR EACH ROW EXECUTE FUNCTION app_meal_service_gate();

-- ---------------------------------------------------------------------
-- Hak akses role aplikasi: tanpa DELETE; skrining append-only; pemusnahan/puasa hanya kolom konfirmasi/cabut.
-- ---------------------------------------------------------------------
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'simrs_app') THEN
    REVOKE ALL ON "blood_unit_disposals", "diet_npo_orders", "nutrition_screenings" FROM simrs_app;
    GRANT SELECT, INSERT ON "blood_unit_disposals", "diet_npo_orders", "nutrition_screenings" TO simrs_app;
    GRANT UPDATE (confirmed_by, confirmed_at) ON "blood_unit_disposals" TO simrs_app;
    GRANT UPDATE (lifted_by, lifted_at) ON "diet_npo_orders" TO simrs_app;
    GRANT UPDATE (cancel_reason, cancelled_by, cancelled_at) ON "blood_requests" TO simrs_app;
    GRANT UPDATE (verified_by, verified_at) ON "diet_orders" TO simrs_app;
  END IF;
END $do$;
