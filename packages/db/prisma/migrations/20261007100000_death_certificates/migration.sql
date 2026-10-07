-- K13 · Surat keterangan kematian (fase 3 potongan 3.6, keputusan K-1 7 Okt 2026). Entri klinis berversi (pola
-- ADR-0028, sama dengan 3.0b/3.0c) agar TTE-nya lewat `ClinicalSigningService` (kunci advisory versi + `RECORD_LOCKED`);
-- sebab kematian ICD-10 dari data rujukan; satu rantai per kunjungan; PDF ber-TTE lewat
-- `documents.source_type = 'death_certificates'`.

-- CreateTable
CREATE TABLE "death_certificates" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "encounter_id" UUID NOT NULL,
    "root_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "supersedes_id" UUID,
    "addendum_of" UUID,
    "status" TEXT NOT NULL DEFAULT 'final',
    "correction_reason" TEXT,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "author_user_id" UUID NOT NULL,
    "author_role" TEXT NOT NULL,
    "died_at" TIMESTAMPTZ(3) NOT NULL,
    "code_system" TEXT NOT NULL DEFAULT 'icd10',
    "code" TEXT NOT NULL,
    "display" TEXT NOT NULL,
    "note" TEXT,

    CONSTRAINT "death_certificates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "death_certificates_tenant_id_encounter_id_idx" ON "death_certificates"("tenant_id", "encounter_id");

-- CreateIndex
CREATE INDEX "death_certificates_tenant_id_patient_id_idx" ON "death_certificates"("tenant_id", "patient_id");

-- CreateIndex
CREATE UNIQUE INDEX "death_certificates_tenant_id_id_key" ON "death_certificates"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "death_certificates_tenant_id_root_id_version_key" ON "death_certificates"("tenant_id", "root_id", "version");

-- FK komposit selama migrasi (FORCE dipulihkan di akhir).
ALTER TABLE "patients" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "encounters" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "users" NO FORCE ROW LEVEL SECURITY;

-- AddForeignKey
ALTER TABLE "death_certificates" ADD CONSTRAINT "death_certificates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "death_certificates" ADD CONSTRAINT "death_certificates_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "death_certificates" ADD CONSTRAINT "death_certificates_tenant_id_encounter_id_fkey" FOREIGN KEY ("tenant_id", "encounter_id") REFERENCES "encounters"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "death_certificates" ADD CONSTRAINT "death_certificates_tenant_id_author_user_id_fkey" FOREIGN KEY ("tenant_id", "author_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "death_certificates" ADD CONSTRAINT "death_certificates_tenant_id_supersedes_id_fkey" FOREIGN KEY ("tenant_id", "supersedes_id") REFERENCES "death_certificates"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "death_certificates" ADD CONSTRAINT "death_certificates_tenant_id_addendum_of_fkey" FOREIGN KEY ("tenant_id", "addendum_of") REFERENCES "death_certificates"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "patients" FORCE ROW LEVEL SECURITY;
ALTER TABLE "encounters" FORCE ROW LEVEL SECURITY;
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;

-- =====================================================================
-- Pola entri klinis berversi (ADR-0028): status, rantai versi, dua stempel waktu, append-only, guard, `_current`.
-- =====================================================================
ALTER TABLE "death_certificates" ADD CONSTRAINT death_certificates_status_valid
  CHECK (status IN ('final', 'entered_in_error'));
ALTER TABLE "death_certificates" ADD CONSTRAINT death_certificates_version_chain CHECK (
  version >= 1
  AND (version = 1) = (supersedes_id IS NULL)
  AND (version = 1) = (id = root_id)
  AND (supersedes_id IS NULL) = (correction_reason IS NULL)
  AND (correction_reason IS NULL OR char_length(btrim(correction_reason)) BETWEEN 10 AND 500)
  AND (status = 'final' OR supersedes_id IS NOT NULL)
  AND NOT (supersedes_id IS NOT NULL AND addendum_of IS NOT NULL)
  AND (addendum_of IS NULL OR addendum_of <> id));
ALTER TABLE "death_certificates" ADD CONSTRAINT death_certificates_author_time CHECK (
  author_role ~ '^[a-z][a-z0-9_]{2,40}$'
  AND occurred_at <= recorded_at + interval '5 minutes');
ALTER TABLE "death_certificates" ADD CONSTRAINT death_certificates_values_valid CHECK (
  code_system = 'icd10'
  AND code ~ '^[A-Z][0-9]{2}(\.[0-9]{1,2})?$'
  AND char_length(btrim(display)) BETWEEN 1 AND 500
  AND (note IS NULL OR char_length(note) <= 500)
  AND died_at <= recorded_at + interval '5 minutes');

-- Satu pengganti per versi (koreksi serentak → satu ditolak) dan satu rantai surat kematian per kunjungan.
CREATE UNIQUE INDEX death_certificates_supersedes_once
  ON "death_certificates" (tenant_id, supersedes_id) WHERE supersedes_id IS NOT NULL;
CREATE UNIQUE INDEX death_certificates_one_per_encounter
  ON "death_certificates" (tenant_id, encounter_id) WHERE version = 1 AND addendum_of IS NULL;

CREATE TRIGGER death_certificates_append_only BEFORE UPDATE OR DELETE ON "death_certificates"
  FOR EACH ROW EXECUTE FUNCTION app_reject_mutation();
-- Rantai versi + kunci TTE + `recorded_at` jam server (fungsi bersama tabel klinis berversi).
CREATE TRIGGER death_certificates_clinical_guard BEFORE INSERT ON "death_certificates"
  FOR EACH ROW EXECUTE FUNCTION app_clinical_guard();
-- Kode baku hanya dari data rujukan (CLAUDE.md §4.10), fungsi yang sama dengan `conditions`.
CREATE TRIGGER death_certificates_code_guard BEFORE INSERT ON "death_certificates"
  FOR EACH ROW EXECUTE FUNCTION app_clinical_code_guard();

-- Kunjungan harus milik pasien yang sama.
CREATE FUNCTION app_death_certificate_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT EXISTS (
       SELECT 1 FROM encounters e
       WHERE e.tenant_id = NEW.tenant_id AND e.id = NEW.encounter_id AND e.patient_id = NEW.patient_id) THEN
    RAISE EXCEPTION 'CLINICAL_CHAIN: kunjungan bukan milik pasien ini' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER death_certificates_encounter_guard BEFORE INSERT ON "death_certificates"
  FOR EACH ROW EXECUTE FUNCTION app_death_certificate_guard();

CREATE VIEW death_certificates_current WITH (security_invoker = true) AS
  SELECT r.* FROM "death_certificates" r WHERE NOT EXISTS (
    SELECT 1 FROM "death_certificates" n WHERE n.tenant_id = r.tenant_id AND n.supersedes_id = r.id);

ALTER TABLE "death_certificates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "death_certificates" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "death_certificates"
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'simrs_app') THEN
    REVOKE ALL ON "death_certificates" FROM simrs_app;
    GRANT SELECT, INSERT ON "death_certificates" TO simrs_app;
    GRANT SELECT ON death_certificates_current TO simrs_app;
  END IF;
END $do$;
