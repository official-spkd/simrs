-- AlterTable
ALTER TABLE "medication_administrations" ADD COLUMN     "double_check_id" UUID;

-- CreateTable
CREATE TABLE "medication_double_checks" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "medication_request_id" UUID NOT NULL,
    "wristband_scan_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "user_role" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "checked_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "medication_double_checks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "medication_double_checks_tenant_id_medication_request_id_idx" ON "medication_double_checks"("tenant_id", "medication_request_id");

-- CreateIndex
CREATE UNIQUE INDEX "medication_double_checks_tenant_id_id_key" ON "medication_double_checks"("tenant_id", "id");

-- FK komposit selama migrasi (FORCE dipulihkan di akhir).
ALTER TABLE "medication_administrations" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "medication_requests" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "wristband_scans" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "users" NO FORCE ROW LEVEL SECURITY;
-- AddForeignKey
ALTER TABLE "medication_administrations" ADD CONSTRAINT "medication_administrations_tenant_id_double_check_id_fkey" FOREIGN KEY ("tenant_id", "double_check_id") REFERENCES "medication_double_checks"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medication_double_checks" ADD CONSTRAINT "medication_double_checks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medication_double_checks" ADD CONSTRAINT "medication_double_checks_tenant_id_medication_request_id_fkey" FOREIGN KEY ("tenant_id", "medication_request_id") REFERENCES "medication_requests"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medication_double_checks" ADD CONSTRAINT "medication_double_checks_tenant_id_wristband_scan_id_fkey" FOREIGN KEY ("tenant_id", "wristband_scan_id") REFERENCES "wristband_scans"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medication_double_checks" ADD CONSTRAINT "medication_double_checks_tenant_id_user_id_fkey" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "medication_administrations" FORCE ROW LEVEL SECURITY;
ALTER TABLE "medication_requests" FORCE ROW LEVEL SECURITY;
ALTER TABLE "wristband_scans" FORCE ROW LEVEL SECURITY;
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;
ALTER TABLE "medication_double_checks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "medication_double_checks" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "medication_double_checks"
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
REVOKE ALL ON "medication_double_checks" FROM simrs_app;
GRANT SELECT, INSERT ON "medication_double_checks" TO simrs_app;
CREATE TRIGGER medication_double_checks_append_only BEFORE UPDATE OR DELETE ON "medication_double_checks"
  FOR EACH ROW EXECUTE FUNCTION app_reject_mutation();
ALTER TABLE "medication_double_checks" ADD CONSTRAINT medication_double_checks_values_valid CHECK (
  user_role IN ('perawat', 'bidan') AND jsonb_typeof(content) = 'object'
  AND content->>'status' = 'given');

-- Pemeriksa berbeda dari pemindai; pasien/kunjungan dan gelang aktif cocok. Waktu dari server.
CREATE FUNCTION app_medication_double_check_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  NEW.checked_at := statement_timestamp();
  IF NOT EXISTS (
    SELECT 1 FROM wristband_scans s
    JOIN medication_requests m ON m.tenant_id = s.tenant_id AND m.encounter_id = s.encounter_id
      AND m.patient_id = s.patient_id AND m.id = NEW.medication_request_id
    JOIN patient_wristbands w ON w.tenant_id = s.tenant_id AND w.id = s.wristband_id AND w.voided_at IS NULL
    WHERE s.tenant_id = NEW.tenant_id AND s.id = NEW.wristband_scan_id AND s.matched
      AND s.user_id <> NEW.user_id AND m.high_alert
  ) THEN
    RAISE EXCEPTION 'DOUBLE_CHECK_REQUIRED: pemeriksa dan dosis harus cocok' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER medication_double_checks_guard BEFORE INSERT ON "medication_double_checks"
  FOR EACH ROW EXECUTE FUNCTION app_medication_double_check_guard();

-- Pengaman tambahan, tanpa mengganti gerbang gelang skema II.
CREATE FUNCTION app_medication_dose_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  med record;
  scan record;
  dose_time timestamptz;
  valid_minutes integer;
  late_minutes integer;
  checked record;
BEGIN
  NEW.recorded_at := statement_timestamp();
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text || ':orders.line:' || NEW.medication_request_id::text, 0));
  SELECT * INTO med FROM medication_requests WHERE tenant_id = NEW.tenant_id AND id = NEW.medication_request_id;
  -- Order tidak dikenal tetap ditolak oleh guard lama/FK.
  IF med.id IS NULL THEN RETURN NEW; END IF;
  IF NEW.label_code <> med.id::text THEN
    RAISE EXCEPTION 'ORDER_GROUP_MISMATCH: label obat tidak cocok' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM order_status_events WHERE tenant_id = NEW.tenant_id AND medication_request_id = med.id
             AND status = 'dibatalkan') THEN
    RAISE EXCEPTION 'ORDER_GROUP_MISMATCH: order dibatalkan' USING ERRCODE = 'P0001';
  END IF;
  IF (med.frequency NOT IN ('prn', 'stat')) <> (NEW.schedule_id IS NOT NULL) THEN
    RAISE EXCEPTION 'ORDER_GROUP_MISMATCH: jenis jadwal tidak cocok' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO scan FROM wristband_scans WHERE tenant_id = NEW.tenant_id AND id = NEW.wristband_scan_id;
  IF scan.id IS NOT NULL THEN
    PERFORM id FROM patient_wristbands WHERE tenant_id = NEW.tenant_id AND id = scan.wristband_id AND voided_at IS NULL FOR SHARE;
    IF NOT FOUND OR scan.scanned_at > NEW.recorded_at OR NEW.occurred_at < scan.scanned_at THEN
      RAISE EXCEPTION 'WRISTBAND_SCAN_REQUIRED: gelang batal atau waktu dosis tidak sesuai' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF NEW.schedule_id IS NOT NULL THEN
    SELECT scheduled_at INTO dose_time FROM medication_schedules WHERE tenant_id = NEW.tenant_id AND id = NEW.schedule_id;
    IF NEW.recorded_at < dose_time - interval '60 minutes' OR NEW.occurred_at < dose_time - interval '60 minutes' THEN
      RAISE EXCEPTION 'ORDER_GROUP_MISMATCH: dosis terlalu awal' USING ERRCODE = 'P0001';
    END IF;
  ELSIF med.frequency = 'stat' THEN
    dose_time := med.created_at;
    IF NEW.status = 'given' AND EXISTS (SELECT 1 FROM medication_administrations
       WHERE tenant_id = NEW.tenant_id AND medication_request_id = med.id AND status = 'given') THEN
      RAISE EXCEPTION 'DOSE_ALREADY_GIVEN: stat hanya sekali' USING ERRCODE = 'P0001';
    END IF;
  ELSIF NEW.status = 'given' AND EXISTS (SELECT 1 FROM medication_administrations
       WHERE tenant_id = NEW.tenant_id AND medication_request_id = med.id
         AND wristband_scan_id = NEW.wristband_scan_id AND status = 'given') THEN
    RAISE EXCEPTION 'DOSE_ALREADY_GIVEN: PRN perlu pindaian baru' USING ERRCODE = 'P0001';
  END IF;
  SELECT coalesce((SELECT (value #>> '{}')::integer FROM tenant_settings
    WHERE tenant_id = NEW.tenant_id AND key = 'emar.late_minutes'), 60) INTO late_minutes;
  NEW.late := dose_time IS NOT NULL AND greatest(NEW.recorded_at, NEW.occurred_at) > dose_time + make_interval(mins => late_minutes);
  IF NEW.double_check_id IS NOT NULL THEN
    SELECT * INTO checked FROM medication_double_checks WHERE tenant_id = NEW.tenant_id AND id = NEW.double_check_id;
    SELECT coalesce((SELECT (value #>> '{}')::integer FROM tenant_settings
      WHERE tenant_id = NEW.tenant_id AND key = 'emar.scan_valid_minutes'), 10) INTO valid_minutes;
    IF checked.id IS NULL OR checked.user_id = NEW.user_id OR checked.user_id IS DISTINCT FROM NEW.double_check_user_id
       OR checked.medication_request_id <> NEW.medication_request_id OR checked.wristband_scan_id <> NEW.wristband_scan_id
       OR checked.checked_at > NEW.recorded_at OR NEW.recorded_at - checked.checked_at > make_interval(mins => valid_minutes)
       OR (checked.content->>'scheduleId')::uuid IS DISTINCT FROM NEW.schedule_id
       OR checked.content->>'labelCode' IS DISTINCT FROM NEW.label_code
       OR checked.content->>'status' IS DISTINCT FROM NEW.status
       OR (checked.content->>'occurredAt')::timestamptz IS DISTINCT FROM NEW.occurred_at
       OR checked.content->>'reason' IS DISTINCT FROM NEW.reason THEN
      RAISE EXCEPTION 'DOUBLE_CHECK_REQUIRED: atestasi tidak cocok dengan dosis' USING ERRCODE = 'P0001';
    END IF;
  ELSIF NEW.double_check_user_id IS NOT NULL OR (med.high_alert AND NEW.status = 'given') THEN
    RAISE EXCEPTION 'DOUBLE_CHECK_REQUIRED: ID pemeriksa saja tidak cukup' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER medication_administrations_dose_guard BEFORE INSERT ON "medication_administrations"
  FOR EACH ROW EXECUTE FUNCTION app_medication_dose_guard();
