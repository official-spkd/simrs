-- Fase 4 potongan 4.6b · S05 dispensing → eMAR (F3-5): pengaman dosis eMAR menerima etiket farmasi `OBT-…` dari obat
-- yang sudah diserahkan untuk order yang sama, selain label lokal stok ruangan (UUID order). Isi fungsi lain sama
-- dengan 20261006140000_nursing_double_checks.

CREATE OR REPLACE FUNCTION app_medication_dose_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
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
  -- Label lokal stok ruangan = UUID order; etiket farmasi (4.6b) = label item penyiapan order ini yang sudah diserahkan.
  IF NEW.label_code <> med.id::text AND NOT EXISTS (
       SELECT 1 FROM dispense_items i JOIN dispenses d ON d.tenant_id = i.tenant_id AND d.id = i.dispense_id
       WHERE i.tenant_id = NEW.tenant_id AND i.label_barcode = NEW.label_code
         AND i.medication_request_id = med.id AND d.handed_over_at IS NOT NULL) THEN
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
