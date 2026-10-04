-- Fase 1 · P06 Master data rujukan: skema `ref` global tanpa tenant_id, read-only bagi aplikasi
-- (docs/01-arsitektur.md §3). Ditulis manual dan tidak dimodelkan Prisma: diakses lewat SQL berparameter di
-- @simrs/db (`ref.ts`), diisi lewat `pnpm db:import-ref` (role migrator). Tidak ada RLS: datanya sama untuk
-- semua RS dan tidak memuat data pasien.
CREATE SCHEMA IF NOT EXISTS ref;

-- Sistem kode yang dikenal + versi dataset yang terakhir diimpor.
CREATE TABLE ref.code_systems (
  id            text PRIMARY KEY,
  uri           text NOT NULL UNIQUE,
  name          text NOT NULL,
  version       text,
  source        text,
  concept_count integer NOT NULL DEFAULT 0,
  imported_at   timestamptz,
  CONSTRAINT code_systems_id_valid CHECK (id IN ('icd10', 'icd9cm', 'loinc', 'kfa'))
);

INSERT INTO ref.code_systems (id, uri, name) VALUES
  ('icd10', 'http://hl7.org/fhir/sid/icd-10', 'ICD-10'),
  ('icd9cm', 'http://hl7.org/fhir/sid/icd-9-cm', 'ICD-9-CM (prosedur)'),
  ('loinc', 'http://loinc.org', 'LOINC'),
  ('kfa', 'http://sys-ids.kemkes.go.id/kfa', 'Kamus Farmasi dan Alat Kesehatan (KFA)');

-- Konsep per sistem. Kode tidak pernah dihapus: versi baru yang tidak memuat kode lama menonaktifkannya.
CREATE TABLE ref.concepts (
  system     text NOT NULL REFERENCES ref.code_systems (id),
  code       text NOT NULL,
  display    text NOT NULL,
  active     boolean NOT NULL DEFAULT true,
  -- Atribut tambahan per sistem (mis. KFA: fornas, high_alert), objek JSON.
  extra      jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (system, code),
  CONSTRAINT concepts_display_length CHECK (char_length(display) BETWEEN 1 AND 500),
  CONSTRAINT concepts_extra_object CHECK (extra IS NULL OR jsonb_typeof(extra) = 'object')
);
CREATE INDEX concepts_display_trgm ON ref.concepts USING gin (lower(display) gin_trgm_ops);

-- Wilayah administratif (kode Kemendagri): provinsi 31 → kab/kota 31.75 → kecamatan 31.75.01 → desa 31.75.01.1001.
CREATE TABLE ref.regions (
  code        text PRIMARY KEY,
  name        text NOT NULL,
  level       text NOT NULL,
  parent_code text REFERENCES ref.regions (code),
  active      boolean NOT NULL DEFAULT true,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT regions_code_format
    CHECK (code ~ '^[0-9]{2}(\.[0-9]{2}(\.[0-9]{2}(\.[0-9]{4})?)?)?$'),
  CONSTRAINT regions_level_valid
    CHECK (level = (ARRAY['provinsi', 'kabupaten', 'kecamatan', 'desa'])[array_length(string_to_array(code, '.'), 1)]),
  CONSTRAINT regions_parent_valid
    CHECK ((parent_code IS NULL) = (strpos(code, '.') = 0) AND (parent_code IS NULL OR code LIKE parent_code || '.%')),
  CONSTRAINT regions_name_length CHECK (char_length(name) BETWEEN 1 AND 200)
);
CREATE INDEX regions_parent ON ref.regions (parent_code);
CREATE INDEX regions_name_trgm ON ref.regions USING gin (lower(name) gin_trgm_ops);

-- Aplikasi hanya membaca; tidak ada hak tulis (impor lewat role migrator).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'simrs_app') THEN
    GRANT USAGE ON SCHEMA ref TO simrs_app;
    GRANT SELECT ON ref.code_systems, ref.concepts, ref.regions TO simrs_app;
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ref.code_systems, ref.concepts, ref.regions FROM simrs_app;
  END IF;
END $$;
