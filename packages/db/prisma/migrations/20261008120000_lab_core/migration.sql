-- Fase 4 · 4.2 · S01 laboratorium inti: order lab panel (mis. "Darah lengkap", tanpa kode LOINC tunggal) dipetakan ke
-- tes lab ber-`panel_code` yang sama (`lab_test_definitions.panel_code`, DL/KIMIA/ELEKTROLIT/LIPID). Tes tunggal tetap
-- lewat `lab_test_definitions.orderable_id`. Kolom tambahan di tabel fase 3 (rencana fase 4: tabel fase 3 tidak
-- diubah selain tambahan kolom lewat migrasi fase 4).

-- AlterTable
ALTER TABLE "orderables" ADD COLUMN     "lab_panel_code" TEXT;

ALTER TABLE "orderables" ADD CONSTRAINT orderables_lab_panel_code_valid CHECK (
  lab_panel_code IS NULL OR (kind = 'lab' AND lab_panel_code ~ '^[A-Z][A-Z0-9_]{1,19}$'));

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'simrs_app') THEN
    -- Master pemeriksaan (admin `lab.master`), sama seperti kolom master lab lain.
    GRANT UPDATE (lab_panel_code) ON "orderables" TO simrs_app;
  END IF;
END $do$;
