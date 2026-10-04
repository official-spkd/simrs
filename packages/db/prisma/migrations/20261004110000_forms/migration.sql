-- Fase 1 · P07 Form engine berversi: definisi formulir (data, MRMIK 6c) dan isian append-only (ADR-0004).
-- Bagian tengah dibangkitkan prisma migrate diff; bagian bawah manual.
-- NO FORCE sementara pada patients (dirujuk FK baru), dikembalikan di akhir berkas.
ALTER TABLE "patients" NO FORCE ROW LEVEL SECURITY;

-- CreateTable
CREATE TABLE "form_definitions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "schema" JSONB NOT NULL,
    "write_roles" TEXT[],
    "change_note" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,
    "submitted_at" TIMESTAMPTZ(3),
    "submitted_by" UUID,
    "published_at" TIMESTAMPTZ(3),
    "published_by" UUID,
    "archived_at" TIMESTAMPTZ(3),

    CONSTRAINT "form_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_responses" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "definition_id" UUID NOT NULL,
    "form_code" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "root_id" UUID NOT NULL,
    "supersedes_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'final',
    "answers" JSONB NOT NULL,
    "score" INTEGER,
    "score_band" TEXT,
    "correction_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "form_responses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "form_definitions_tenant_id_id_key" ON "form_definitions"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "form_definitions_tenant_id_code_version_key" ON "form_definitions"("tenant_id", "code", "version");

-- CreateIndex
CREATE INDEX "form_responses_tenant_id_patient_id_form_code_idx" ON "form_responses"("tenant_id", "patient_id", "form_code");

-- CreateIndex
CREATE UNIQUE INDEX "form_responses_tenant_id_id_key" ON "form_responses"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "form_responses_tenant_id_root_id_version_key" ON "form_responses"("tenant_id", "root_id", "version");

-- AddForeignKey
ALTER TABLE "form_definitions" ADD CONSTRAINT "form_definitions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_responses" ADD CONSTRAINT "form_responses_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_responses" ADD CONSTRAINT "form_responses_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_responses" ADD CONSTRAINT "form_responses_tenant_id_definition_id_fkey" FOREIGN KEY ("tenant_id", "definition_id") REFERENCES "form_definitions"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_responses" ADD CONSTRAINT "form_responses_tenant_id_supersedes_id_fkey" FOREIGN KEY ("tenant_id", "supersedes_id") REFERENCES "form_responses"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================
-- Batasan domain
-- =====================================================================
ALTER TABLE "form_definitions" ADD CONSTRAINT form_definitions_code_format CHECK (code ~ '^[a-z][a-z0-9_]{2,40}$');
ALTER TABLE "form_definitions" ADD CONSTRAINT form_definitions_version_positive CHECK (version >= 1);
ALTER TABLE "form_definitions" ADD CONSTRAINT form_definitions_category_valid
  CHECK (category IN ('keperawatan', 'medis', 'kebidanan', 'umum'));
ALTER TABLE "form_definitions" ADD CONSTRAINT form_definitions_status_valid
  CHECK (status IN ('draft', 'submitted', 'published', 'archived'));
ALTER TABLE "form_definitions" ADD CONSTRAINT form_definitions_schema_object CHECK (jsonb_typeof(schema) = 'object');
ALTER TABLE "form_definitions" ADD CONSTRAINT form_definitions_write_roles_present
  CHECK (cardinality(write_roles) BETWEEN 1 AND 20);
-- Jejak siklus: terbit selalu lewat pengajuan; arsip hanya dari terbit.
ALTER TABLE "form_definitions" ADD CONSTRAINT form_definitions_lifecycle_valid CHECK (
  (status IN ('submitted', 'published', 'archived')) = (submitted_at IS NOT NULL)
  AND (status IN ('published', 'archived')) = (published_at IS NOT NULL)
  AND (status = 'archived') = (archived_at IS NOT NULL));
-- Satu versi berlaku dan paling banyak satu draf terbuka per kode formulir.
CREATE UNIQUE INDEX form_definitions_one_published
  ON "form_definitions" ("tenant_id", "code") WHERE status = 'published';
CREATE UNIQUE INDEX form_definitions_one_open_draft
  ON "form_definitions" ("tenant_id", "code") WHERE status IN ('draft', 'submitted');

ALTER TABLE "form_responses" ADD CONSTRAINT form_responses_status_valid
  CHECK (status IN ('final', 'entered_in_error'));
ALTER TABLE "form_responses" ADD CONSTRAINT form_responses_answers_object CHECK (jsonb_typeof(answers) = 'object');
-- Versi 1 = akar tanpa pendahulu; versi berikutnya selalu menggantikan versi sebelumnya dengan alasan.
ALTER TABLE "form_responses" ADD CONSTRAINT form_responses_version_chain CHECK (
  version >= 1
  AND (version = 1) = (supersedes_id IS NULL)
  AND (version = 1) = (id = root_id)
  AND (supersedes_id IS NULL) = (correction_reason IS NULL)
  AND (correction_reason IS NULL OR char_length(correction_reason) BETWEEN 10 AND 500));
-- Satu versi hanya bisa dikoreksi sekali (dua koreksi serentak: yang kedua ditolak).
CREATE UNIQUE INDEX form_responses_supersedes_once
  ON "form_responses" ("tenant_id", "supersedes_id") WHERE supersedes_id IS NOT NULL;

-- Isian klinis append-only: UPDATE/DELETE ditolak untuk siapa pun (ADR-0004).
CREATE TRIGGER form_responses_append_only
  BEFORE UPDATE OR DELETE ON "form_responses"
  FOR EACH ROW EXECUTE FUNCTION app_reject_mutation();

-- Isi definisi yang sudah terbit/arsip tidak boleh berubah (isian lama memakai versi itu); hanya perubahan
-- status published -> archived yang diizinkan. Draf/diajukan bebas diubah sampai terbit.
CREATE FUNCTION app_form_definition_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'FORM_DEFINITION_IMMUTABLE: definisi formulir tidak dihapus' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.status IN ('published', 'archived') AND (
       NEW.schema IS DISTINCT FROM OLD.schema OR NEW.title IS DISTINCT FROM OLD.title
       OR NEW.write_roles IS DISTINCT FROM OLD.write_roles OR NEW.code IS DISTINCT FROM OLD.code
       OR NEW.version IS DISTINCT FROM OLD.version OR NEW.category IS DISTINCT FROM OLD.category
       OR NOT (NEW.status = OLD.status OR (OLD.status = 'published' AND NEW.status = 'archived'))) THEN
    RAISE EXCEPTION 'FORM_DEFINITION_IMMUTABLE: versi % formulir % sudah terbit', OLD.version, OLD.code
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $fn$;

CREATE TRIGGER form_definitions_guard
  BEFORE UPDATE OR DELETE ON "form_definitions"
  FOR EACH ROW EXECUTE FUNCTION app_form_definition_guard();

-- Versi terbaru tiap isian (ADR-0004: view `_current`). security_invoker: RLS pemanggil tetap berlaku.
CREATE VIEW form_responses_current WITH (security_invoker = true) AS
  SELECT r.* FROM form_responses r
  WHERE NOT EXISTS (
    SELECT 1 FROM form_responses n WHERE n.tenant_id = r.tenant_id AND n.supersedes_id = r.id);

-- =====================================================================
-- RLS
-- =====================================================================
DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['form_definitions', 'form_responses'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())',
      t);
  END LOOP;
END $do$;

-- =====================================================================
-- Hak akses
-- - form_definitions: tidak dihapus; isi hanya berubah selama draf (trigger), siklus lewat kolom status.
-- - form_responses: hanya sisip dan baca.
-- =====================================================================
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'simrs_app') THEN
    GRANT SELECT, INSERT ON "form_definitions", "form_responses" TO simrs_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON "form_definitions", "form_responses" FROM simrs_app;
    GRANT UPDATE (title, status, schema, write_roles, change_note, updated_at, updated_by, submitted_at,
                  submitted_by, published_at, published_by, archived_at)
      ON "form_definitions" TO simrs_app;
    GRANT SELECT ON form_responses_current TO simrs_app;
  END IF;
END $do$;

-- Kembalikan FORCE RLS (lihat catatan di awal berkas).
ALTER TABLE "patients" FORCE ROW LEVEL SECURITY;
