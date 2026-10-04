-- Fase 1 · P08 Dokumen pasien dan tanda tangan elektronik (ADR-0020).
-- Bagian tengah dibangkitkan prisma migrate diff; bagian bawah manual.
-- NO FORCE sementara pada patients dan users (dirujuk FK baru), dikembalikan di akhir berkas.
ALTER TABLE "patients" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "users" NO FORCE ROW LEVEL SECURITY;

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "voided_at" TIMESTAMPTZ(3),
    "voided_by" UUID,
    "void_reason" TEXT,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_signatures" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "signer_user_id" UUID NOT NULL,
    "document_sha256" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "verify_code" TEXT NOT NULL,
    "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "signed_at" TIMESTAMPTZ(3),
    "provider_signature_id" TEXT,
    "certificate" TEXT,
    "signature" TEXT,

    CONSTRAINT "document_signatures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "documents_storage_key_key" ON "documents"("storage_key");

-- CreateIndex
CREATE INDEX "documents_tenant_id_patient_id_created_at_idx" ON "documents"("tenant_id", "patient_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "documents_tenant_id_id_key" ON "documents"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "document_signatures_verify_code_key" ON "document_signatures"("verify_code");

-- CreateIndex
CREATE UNIQUE INDEX "document_signatures_tenant_id_id_key" ON "document_signatures"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "document_signatures_tenant_id_document_id_signer_user_id_key" ON "document_signatures"("tenant_id", "document_id", "signer_user_id");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_signatures" ADD CONSTRAINT "document_signatures_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_signatures" ADD CONSTRAINT "document_signatures_tenant_id_document_id_fkey" FOREIGN KEY ("tenant_id", "document_id") REFERENCES "documents"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_signatures" ADD CONSTRAINT "document_signatures_tenant_id_signer_user_id_fkey" FOREIGN KEY ("tenant_id", "signer_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- =====================================================================
-- Batasan domain
-- =====================================================================
ALTER TABLE "documents" ADD CONSTRAINT documents_kind_valid
  CHECK (kind IN ('lampiran', 'hasil', 'surat', 'resume', 'consent', 'lainnya'));
ALTER TABLE "documents" ADD CONSTRAINT documents_mime_valid
  CHECK (mime_type IN ('application/pdf', 'image/png', 'image/jpeg'));
ALTER TABLE "documents" ADD CONSTRAINT documents_size_valid CHECK (size_bytes BETWEEN 1 AND 10485760);
ALTER TABLE "documents" ADD CONSTRAINT documents_sha256_format CHECK (sha256 ~ '^[a-f0-9]{64}$');
ALTER TABLE "documents" ADD CONSTRAINT documents_title_length CHECK (char_length(title) BETWEEN 3 AND 200);
ALTER TABLE "documents" ADD CONSTRAINT documents_file_name_length CHECK (char_length(file_name) BETWEEN 1 AND 130);
-- Kunci penyimpanan selalu buatan server: <tenant>/<tahun>/<bulan>/<uuid> (tidak ada path dari klien).
ALTER TABLE "documents" ADD CONSTRAINT documents_storage_key_format
  CHECK (storage_key ~ '^[0-9a-f-]{36}/[0-9]{4}/[0-9]{2}/[0-9a-f-]{36}$'
         AND split_part(storage_key, '/', 1) = tenant_id::text);
-- Batal: ketiga kolom terisi bersamaan, alasan 10–500 karakter.
ALTER TABLE "documents" ADD CONSTRAINT documents_void_consistent CHECK (
  (voided_at IS NULL) = (voided_by IS NULL) AND (voided_at IS NULL) = (void_reason IS NULL)
  AND (void_reason IS NULL OR char_length(void_reason) BETWEEN 10 AND 500));

ALTER TABLE "document_signatures" ADD CONSTRAINT document_signatures_status_valid
  CHECK (status IN ('pending', 'signed'));
ALTER TABLE "document_signatures" ADD CONSTRAINT document_signatures_sha256_format
  CHECK (document_sha256 ~ '^[a-f0-9]{64}$');
ALTER TABLE "document_signatures" ADD CONSTRAINT document_signatures_verify_code_format
  CHECK (verify_code ~ '^sv1\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$'
         AND split_part(verify_code, '.', 2) = tenant_id::text);
ALTER TABLE "document_signatures" ADD CONSTRAINT document_signatures_signed_consistent CHECK (
  (status = 'signed') = (signed_at IS NOT NULL)
  AND (status = 'signed') = (certificate IS NOT NULL)
  AND (status = 'signed') = (signature IS NOT NULL));

-- Dokumen tidak pernah diubah/dihapus; yang boleh hanya menandai batal SEKALI, dan tidak untuk dokumen yang
-- sedang/sudah ditandatangani (perubahan dokumen final lewat addendum, ADR-0004).
CREATE FUNCTION app_document_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  mutable CONSTANT text[] := ARRAY['voided_at', 'voided_by', 'void_reason'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'DOCUMENT_IMMUTABLE: dokumen tidak dihapus' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.voided_at IS NOT NULL OR (to_jsonb(NEW) - mutable) IS DISTINCT FROM (to_jsonb(OLD) - mutable) THEN
    RAISE EXCEPTION 'DOCUMENT_IMMUTABLE: dokumen % tidak bisa diubah', OLD.id USING ERRCODE = 'P0001';
  END IF;
  IF NEW.voided_at IS NOT NULL AND EXISTS (
       SELECT 1 FROM document_signatures s WHERE s.tenant_id = OLD.tenant_id AND s.document_id = OLD.id) THEN
    RAISE EXCEPTION 'DOCUMENT_SIGNED: dokumen yang ditandatangani tidak bisa dibatalkan' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER documents_guard
  BEFORE UPDATE OR DELETE ON "documents"
  FOR EACH ROW EXECUTE FUNCTION app_document_guard();

-- Tanda tangan: hash yang ditandatangani = hash dokumen; dokumen batal tidak bisa ditandatangani (baris dokumen
-- dikunci FOR SHARE agar tidak balapan dengan pembatalan); setelah `signed` terkunci; tidak pernah dihapus.
CREATE FUNCTION app_document_signature_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  mutable CONSTANT text[] := ARRAY['status', 'signed_at', 'provider_signature_id', 'certificate', 'signature'];
  doc_sha text;
  doc_voided timestamptz;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'SIGNATURE_IMMUTABLE: tanda tangan tidak dihapus' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT d.sha256, d.voided_at INTO doc_sha, doc_voided
      FROM documents d WHERE d.tenant_id = NEW.tenant_id AND d.id = NEW.document_id FOR SHARE;
    IF doc_voided IS NOT NULL THEN
      RAISE EXCEPTION 'DOCUMENT_VOIDED: dokumen batal tidak bisa ditandatangani' USING ERRCODE = 'P0001';
    END IF;
    IF doc_sha IS DISTINCT FROM NEW.document_sha256 THEN
      RAISE EXCEPTION 'SIGNATURE_HASH_MISMATCH: hash tanda tangan berbeda dengan hash dokumen' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status <> 'pending' OR (to_jsonb(NEW) - mutable) IS DISTINCT FROM (to_jsonb(OLD) - mutable) THEN
    RAISE EXCEPTION 'SIGNATURE_IMMUTABLE: tanda tangan % sudah final', OLD.id USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER document_signatures_guard
  BEFORE INSERT OR UPDATE OR DELETE ON "document_signatures"
  FOR EACH ROW EXECUTE FUNCTION app_document_signature_guard();

-- =====================================================================
-- RLS
-- =====================================================================
DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['documents', 'document_signatures'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())',
      t);
  END LOOP;
END $do$;

-- =====================================================================
-- Hak akses: sisip + baca; ubah hanya kolom pembatalan / hasil TTE (trigger menjaga isinya).
-- =====================================================================
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'simrs_app') THEN
    GRANT SELECT, INSERT ON "documents", "document_signatures" TO simrs_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON "documents", "document_signatures" FROM simrs_app;
    GRANT UPDATE (voided_at, voided_by, void_reason) ON "documents" TO simrs_app;
    GRANT UPDATE (status, signed_at, provider_signature_id, certificate, signature)
      ON "document_signatures" TO simrs_app;
  END IF;
END $do$;

-- Kembalikan FORCE RLS (lihat catatan di awal berkas).
ALTER TABLE "patients" FORCE ROW LEVEL SECURITY;
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;
