-- Fase 2 · potongan 3 (F02 booking): status kirim Antrean BPJS per booking (add + batal) dan satu booking aktif per
-- pasien × layanan × tanggal. Tanpa NO FORCE: tidak ada FK baru.

-- AlterTable
ALTER TABLE "appointments" ADD COLUMN     "bpjs_cancel_error_code" TEXT,
ADD COLUMN     "bpjs_cancel_status" TEXT NOT NULL DEFAULT 'not_required',
ADD COLUMN     "bpjs_error_code" TEXT,
ADD COLUMN     "bpjs_sync_status" TEXT NOT NULL DEFAULT 'not_required',
ADD COLUMN     "bpjs_synced_at" TIMESTAMPTZ(3);

-- Nilai = `BPJS_SYNC_STATUSES` (@simrs/shared). Non-JKN tidak pernah dikirim; `sent` selalu punya waktu terima.
ALTER TABLE "appointments" ADD CONSTRAINT appointments_bpjs_sync_valid CHECK (
  bpjs_sync_status IN ('not_required', 'pending', 'sent', 'rejected', 'dead')
  AND bpjs_cancel_status IN ('not_required', 'pending', 'sent', 'rejected', 'dead')
  AND (quota_bucket = 'jkn' OR (bpjs_sync_status = 'not_required' AND bpjs_cancel_status = 'not_required'))
  AND (bpjs_sync_status <> 'sent' OR bpjs_synced_at IS NOT NULL)
  AND (bpjs_error_code IS NULL OR char_length(bpjs_error_code) BETWEEN 3 AND 60)
  AND (bpjs_cancel_error_code IS NULL OR char_length(bpjs_cancel_error_code) BETWEEN 3 AND 60));

-- Satu booking aktif per pasien × layanan × tanggal: dua permintaan serentak untuk pasien yang sama tidak bisa
-- sama-sama lolos (`BOOKING_DUPLICATE`).
-- Sebelum potongan ini belum ada API booking: baris `appointments` yang ada hanya data uji (tes database 0b) dan bisa
-- melanggar aturan baru. Booking aktif ganda (selain yang terbaru) dibatalkan dengan alasan jelas agar indeks bisa
-- dibuat di semua basis data pengembangan/tes. NO FORCE sementara: UPDATE tanpa konteks tenant di bawah FORCE RLS
-- gagal TENANT_REQUIRED.
ALTER TABLE "appointments" NO FORCE ROW LEVEL SECURITY;
UPDATE "appointments" a
SET status = 'cancelled', cancelled_at = now(), cancel_reason = 'Data uji ganda (migrasi 20261005175000)',
    updated_at = now()
WHERE a.status IN ('booked', 'checked_in')
  AND EXISTS (
    SELECT 1 FROM "appointments" b
    WHERE b.tenant_id = a.tenant_id AND b.patient_id = a.patient_id AND b.service_id = a.service_id
      AND b.appointment_date = a.appointment_date AND b.status IN ('booked', 'checked_in')
      AND (b.created_at, b.id) > (a.created_at, a.id));
ALTER TABLE "appointments" FORCE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX appointments_one_active_per_day
  ON "appointments" ("tenant_id", "patient_id", "service_id", "appointment_date")
  WHERE status IN ('booked', 'checked_in');

-- Hak kolom aplikasi untuk kolom baru (diisi API saat booking/batal dan worker saat hasil BPJS diterima).
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'simrs_app') THEN
    GRANT UPDATE (bpjs_sync_status, bpjs_synced_at, bpjs_error_code, bpjs_cancel_status, bpjs_cancel_error_code)
      ON "appointments" TO simrs_app;
  END IF;
END $do$;
