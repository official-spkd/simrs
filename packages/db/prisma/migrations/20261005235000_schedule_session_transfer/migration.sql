-- Fase 2 · potongan 2 (F01, utang tinjauan): penanda pengalihan pasien sesi cuti. Setelah petugas menyetujui
-- pengalihan (ke dokter pengganti atau sesi lain), layar Jadwal menampilkan "sudah dialihkan" dan pemberitahuan
-- WhatsApp tidak diantrekan ulang. Tanpa FK baru (tidak perlu NO FORCE), tanpa fungsi.

ALTER TABLE "schedule_sessions" ADD COLUMN "transferred_at" TIMESTAMPTZ(3),
ADD COLUMN "transferred_by" UUID,
ADD COLUMN "transfer_target" TEXT;

ALTER TABLE "schedule_sessions" ADD CONSTRAINT schedule_sessions_transfer_valid CHECK (
  (transferred_at IS NULL) = (transfer_target IS NULL)
  AND (transfer_target IS NULL OR (transfer_target IN ('substitute', 'session') AND kind = 'cuti')));

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'simrs_app') THEN
    GRANT UPDATE (transferred_at, transferred_by, transfer_target) ON "schedule_sessions" TO simrs_app;
  END IF;
END $do$;
