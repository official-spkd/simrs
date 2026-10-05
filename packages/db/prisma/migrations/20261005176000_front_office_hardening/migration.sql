-- Fase 2 · temuan peninjau S atas skema 0b (dikerjakan bersama potongan 3):
-- 1. Master front office dan sesi jadwal: hak UPDATE aplikasi dipersempit ke kolom bisnis yang memang berubah dari
--    layar. `id`, `tenant_id`, kode (awalan nomor antrean, kode penjamin/display), dan jejak `created_*` tidak bisa
--    diubah aplikasi.
-- 2. `external_ids`: kode 1:1 (mis. kode dokter HFIS) unik per RS × sistem selama aktif. Kode poli BPJS boleh dipakai
--    beberapa layanan (mis. dua ruang Penyakit Dalam), jadi dikecualikan.
-- 3. CHECK `appointments_jkn_reference` (NOT VALID di 20261005162000) divalidasi bila data mengizinkan; bila ada baris
--    lama yang melanggar (data uji sebelum aturan), constraint tetap NOT VALID + peringatan, tidak ada data diubah.

-- =====================================================================
-- 1. Hak kolom
-- =====================================================================
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'simrs_app') THEN
    REVOKE UPDATE ON "practitioners", "external_ids", "payers", "queue_services", "queue_displays",
      "queue_display_services", "practitioner_schedules", "schedule_sessions" FROM simrs_app;
    GRANT UPDATE (user_id, name, profession, specialty, str_number, sip_number, sip_valid_until, ihs_id, active,
                  updated_at, updated_by)
      ON "practitioners" TO simrs_app;
    GRANT UPDATE (value, active, updated_at, updated_by) ON "external_ids" TO simrs_app;
    GRANT UPDATE (name, kind, active, updated_at, updated_by) ON "payers" TO simrs_app;
    GRANT UPDATE (name, kind, unit_id, room, floor, active, updated_at, updated_by) ON "queue_services" TO simrs_app;
    GRANT UPDATE (name, active, updated_at, updated_by) ON "queue_displays" TO simrs_app;
    GRANT UPDATE (position, active, updated_at, updated_by) ON "queue_display_services" TO simrs_app;
    -- Templat: perubahan besar = akhiri (`valid_until`) + templat baru; hari/praktisi/layanan/awal berlaku tetap.
    GRANT UPDATE (start_time, end_time, quota_jkn, quota_non_jkn, valid_until, active, updated_at, updated_by)
      ON "practitioner_schedules" TO simrs_app;
    -- Sesi: jam, cuti/pengganti, kuota (CHECK `schedule_sessions_quota`), terisi (`reserveQuota`), sinkron HFIS.
    GRANT UPDATE (start_time, end_time, kind, substitute_practitioner_id, quota_jkn, quota_non_jkn, booked_jkn,
                  booked_non_jkn, note, hfis_synced_at, updated_at, updated_by)
      ON "schedule_sessions" TO simrs_app;
  END IF;
END $do$;

-- =====================================================================
-- 2. Kode luar 1:1
-- =====================================================================
CREATE UNIQUE INDEX external_ids_one_owner_per_value
  ON "external_ids" ("tenant_id", "system", "value")
  WHERE active AND system <> 'bpjs:poli';

-- =====================================================================
-- 3. Validasi CHECK booking JKN (gagal aman). NO FORCE sementara: pemilik tabel menghitung semua tenant.
-- =====================================================================
ALTER TABLE "appointments" NO FORCE ROW LEVEL SECURITY;
DO $do$
DECLARE bad bigint;
BEGIN
  SELECT count(*) INTO bad FROM appointments
  WHERE NOT (
    (jkn_visit_kind IS NULL OR jkn_visit_kind BETWEEN 1 AND 4)
    AND (reference_number IS NULL OR char_length(reference_number) BETWEEN 1 AND 40)
    AND (quota_bucket <> 'jkn' OR (jkn_visit_kind IS NOT NULL AND reference_number IS NOT NULL))
    AND (quota_bucket <> 'non_jkn' OR jkn_visit_kind IS NULL));
  IF bad = 0 THEN
    ALTER TABLE appointments VALIDATE CONSTRAINT appointments_jkn_reference;
  ELSE
    RAISE WARNING 'appointments_jkn_reference belum divalidasi: % baris lama melanggar (data uji, tidak diubah)', bad;
  END IF;
END $do$;
ALTER TABLE "appointments" FORCE ROW LEVEL SECURITY;
