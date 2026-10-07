-- Fase 4 · 4.1a · Infrastruktur penunjang (rencana fase 4 §4.1a):
-- 1. Jenis perangkat `lab_analyzer` (ADR-0027) dengan kunci HMAC terenkripsi (`hmac_key_enc`, ADR-0015) untuk
--    `X-Device-Signature`; diisi tepat saat mendaftar, hanya berubah oleh rotasi kunci kolom.
-- 2. Siklus pemroses pesan masuk generik `inbound_events`: percobaan, jadwal berikutnya, perangkat pengirim, status
--    baku, batas ukuran, dan jaminan PID/NK1 HL7 sudah diredaksi sebelum disimpan.
-- 3. Kanal SSE penunjang (ADR-0026): `pg_notify` saat riwayat status lab/farmasi/OK dan nilai kritis ditulis.
-- Validasi FK komposit baru tanpa konteks tenant: FORCE RLS dilepas sementara, dipulihkan di akhir berkas.
ALTER TABLE "registered_devices" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "inbound_events" NO FORCE ROW LEVEL SECURITY;

-- AlterTable
ALTER TABLE "inbound_events" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "device_id" UUID,
ADD COLUMN     "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "registered_devices" ADD COLUMN     "hmac_key_enc" TEXT;

-- CreateIndex
CREATE INDEX "inbound_events_tenant_id_status_next_attempt_at_idx" ON "inbound_events"("tenant_id", "status", "next_attempt_at");

-- AddForeignKey
ALTER TABLE "inbound_events" ADD CONSTRAINT "inbound_events_tenant_id_device_id_fkey" FOREIGN KEY ("tenant_id", "device_id") REFERENCES "registered_devices"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================
-- 1. Perangkat analyzer lab
-- =====================================================================
ALTER TABLE "registered_devices" DROP CONSTRAINT registered_devices_kind;
ALTER TABLE "registered_devices" ADD CONSTRAINT registered_devices_kind
  CHECK (kind IN ('staff_pin', 'kiosk', 'queue_display', 'lab_analyzer'));
-- Analyzer = prinsipal perangkat seperti anjungan/display: terikat unit, tanpa akun/posisi/PIN, kode pendaftaran.
ALTER TABLE "registered_devices" DROP CONSTRAINT registered_devices_principal;
ALTER TABLE "registered_devices" ADD CONSTRAINT registered_devices_principal CHECK (
  kind NOT IN ('kiosk', 'queue_display', 'lab_analyzer') OR (
    unit_id IS NOT NULL AND user_id IS NULL AND assignment_id IS NULL AND pin_hash IS NULL
    AND expires_at <= created_at + interval '366 days'
    AND enrol_expires_at IS NOT NULL AND enrol_expires_at > created_at
    AND enrol_expires_at <= created_at + interval '1 day'
    AND (token_hash IS NULL) = (enrolled_at IS NULL)
    AND (enrolled_at IS NULL OR (enrol_code_hash IS NULL AND enrolled_at <= enrol_expires_at))
    AND (enrolled_at IS NOT NULL OR enrol_code_hash IS NOT NULL OR revoked_at IS NOT NULL)));
-- Kunci HMAC: hanya analyzer, ada tepat saat sudah mendaftar, format ciphertext kolom berversi (`vN.iv.ct.tag`).
ALTER TABLE "registered_devices" ADD CONSTRAINT registered_devices_hmac_key CHECK (
  CASE WHEN kind = 'lab_analyzer' THEN (hmac_key_enc IS NULL) = (enrolled_at IS NULL) ELSE hmac_key_enc IS NULL END
  AND (hmac_key_enc IS NULL OR app_field_key_id(hmac_key_enc) IS NOT NULL));

-- Penjaga (ADR-0027, diperluas): pendaftaran sekali (token + waktu daftar + kunci HMAC analyzer), selebihnya hanya
-- kolom pakai/pencabutan. Kunci HMAC hanya boleh berganti ID kunci (enkripsi ulang oleh rotasi kunci kolom); nilai
-- dengan ID kunci yang sama (penggantian kunci perangkat diam-diam) ditolak.
CREATE OR REPLACE FUNCTION app_registered_device_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  mutable CONSTANT text[] := ARRAY['failed_attempts', 'last_used_at', 'revoked_at', 'revoked_reason', 'revoked_by'];
  enrolment CONSTANT text[] := ARRAY['token_hash', 'enrolled_at', 'enrol_code_hash', 'user_agent', 'hmac_key_enc'];
  rekey boolean;
BEGIN
  IF OLD.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'DEVICE_IMMUTABLE: perangkat terdaftar % tidak bisa diubah', OLD.id USING ERRCODE = 'P0001';
  END IF;
  IF OLD.enrolled_at IS NULL AND NEW.enrolled_at IS NOT NULL THEN
    IF OLD.kind NOT IN ('kiosk', 'queue_display', 'lab_analyzer') OR OLD.enrol_code_hash IS NULL
       OR NEW.enrol_code_hash IS NOT NULL OR NEW.token_hash IS NULL OR now() > OLD.enrol_expires_at
       OR (to_jsonb(NEW) - mutable - enrolment) IS DISTINCT FROM (to_jsonb(OLD) - mutable - enrolment) THEN
      RAISE EXCEPTION 'DEVICE_IMMUTABLE: pendaftaran perangkat % tidak sah', OLD.id USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;
  rekey := OLD.hmac_key_enc IS NOT NULL AND NEW.hmac_key_enc IS NOT NULL
    AND app_field_key_id(NEW.hmac_key_enc) IS DISTINCT FROM app_field_key_id(OLD.hmac_key_enc);
  IF (to_jsonb(NEW) - mutable - CASE WHEN rekey THEN 'hmac_key_enc' ELSE '' END)
     IS DISTINCT FROM (to_jsonb(OLD) - mutable - CASE WHEN rekey THEN 'hmac_key_enc' ELSE '' END) THEN
    RAISE EXCEPTION 'DEVICE_IMMUTABLE: perangkat terdaftar % tidak bisa diubah', OLD.id USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $fn$;

-- Rotasi kunci kolom mencakup kunci HMAC analyzer (`registered_devices.hmac_key_enc`).
ALTER TABLE "field_key_rotations" DROP CONSTRAINT field_key_rotations_target_valid;
ALTER TABLE "field_key_rotations" ADD CONSTRAINT field_key_rotations_target_valid CHECK (target IN (
  'users', 'mfa_factors', 'login_challenges', 'patients', 'patient_identifiers', 'patient_links',
  'patient_contacts', 'coverages', 'registered_devices'));

-- =====================================================================
-- 2. Pesan masuk generik (dipakai ulang webhook TPDI fase 6)
-- =====================================================================
-- `processed_at` hanya untuk yang selesai; galat tanpa PHI dan dipotong; body maks. 256 KB (batas ingest HL7).
ALTER TABLE "inbound_events" ADD CONSTRAINT inbound_events_values_valid CHECK (
  status IN ('received', 'processing', 'processed', 'failed', 'dead')
  AND attempts >= 0
  AND char_length(source) BETWEEN 1 AND 40
  AND char_length(idempotency_key) BETWEEN 1 AND 200
  AND octet_length(raw_body) <= 262144
  AND (error IS NULL OR char_length(error) <= 500)
  AND ((status = 'processed') = (processed_at IS NOT NULL)));
-- HL7 analyzer: segmen PID/NK1 wajib sudah diredaksi menjadi `PID|1` / `NK1|1` (pencocokan hanya lewat barcode OBR).
ALTER TABLE "inbound_events" ADD CONSTRAINT inbound_events_hl7_redacted CHECK (
  source <> 'lis-hl7' OR raw_body !~ '(^|[\r\n])(PID|NK1)[^\r\n]{3,}');
-- Analyzer selalu bertanda perangkat pengirim.
ALTER TABLE "inbound_events" ADD CONSTRAINT inbound_events_lis_device CHECK (
  source <> 'lis-hl7' OR device_id IS NOT NULL);

-- =====================================================================
-- 3. Kanal SSE penunjang (ADR-0026): payload hanya tenant_id + id baris (`app_notify_row`)
-- =====================================================================
CREATE TRIGGER lab_order_status_history_notify AFTER INSERT ON "lab_order_status_history"
  FOR EACH ROW EXECUTE FUNCTION app_notify_row('support_lab_worklist');
CREATE TRIGGER pharmacy_prescription_status_history_notify AFTER INSERT ON "pharmacy_prescription_status_history"
  FOR EACH ROW EXECUTE FUNCTION app_notify_row('support_pharmacy_queue');
CREATE TRIGGER surgery_case_status_history_notify AFTER INSERT ON "surgery_case_status_history"
  FOR EACH ROW EXECUTE FUNCTION app_notify_row('support_surgery_board');
CREATE TRIGGER critical_results_notify AFTER INSERT ON "critical_results"
  FOR EACH ROW EXECUTE FUNCTION app_notify_row('support_critical');
CREATE TRIGGER critical_result_reports_notify AFTER INSERT ON "critical_result_reports"
  FOR EACH ROW EXECUTE FUNCTION app_notify_row('support_critical');
CREATE TRIGGER critical_result_escalations_notify AFTER INSERT ON "critical_result_escalations"
  FOR EACH ROW EXECUTE FUNCTION app_notify_row('support_critical');

-- =====================================================================
-- Hak akses
-- =====================================================================
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'simrs_app') THEN
    -- Kunci HMAC diisi saat mendaftar dan dienkripsi ulang oleh rotasi kunci kolom (penjaga di atas membatasi kapan).
    GRANT UPDATE (hmac_key_enc) ON "registered_devices" TO simrs_app;
  END IF;
END $do$;

ALTER TABLE "registered_devices" FORCE ROW LEVEL SECURITY;
ALTER TABLE "inbound_events" FORCE ROW LEVEL SECURITY;
