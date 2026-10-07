-- Fase 3 · 3.7 · K11 · Draf persetujuan tindakan tablet (BUKAN rekam medis). Draf disiapkan dari templat P07,
-- ditandatangani pasien/wali + saksi, diatestasi saksi petugas, lalu difinalkan dokter menjadi `consents` ber-TTE
-- (atau penolakan) atau dibatalkan beralasan. Tutup-sekali: setelah keluar dari `draf` tidak berubah lagi.

-- CreateTable
CREATE TABLE "consent_drafts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "encounter_id" UUID NOT NULL,
    "form_definition_id" UUID NOT NULL,
    "procedure" TEXT NOT NULL,
    "signer_kind" TEXT NOT NULL,
    "information" JSONB NOT NULL,
    "explained_at" TIMESTAMPTZ(3),
    "signer" JSONB,
    "family_witness" JSONB,
    "signed_at" TIMESTAMPTZ(3),
    "staff_witness_user_id" UUID,
    "staff_witnessed_at" TIMESTAMPTZ(3),
    "status" TEXT NOT NULL DEFAULT 'draf',
    "consent_id" UUID,
    "closed_at" TIMESTAMPTZ(3),
    "closed_by" UUID,
    "cancel_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "consent_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "consent_drafts_tenant_id_encounter_id_idx" ON "consent_drafts"("tenant_id", "encounter_id");

-- CreateIndex
CREATE UNIQUE INDEX "consent_drafts_tenant_id_id_key" ON "consent_drafts"("tenant_id", "id");

-- FK komposit selama migrasi (FORCE dipulihkan di akhir).
ALTER TABLE "patients" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "encounters" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "form_definitions" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "consents" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "users" NO FORCE ROW LEVEL SECURITY;

-- AddForeignKey
ALTER TABLE "consent_drafts" ADD CONSTRAINT "consent_drafts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_drafts" ADD CONSTRAINT "consent_drafts_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_drafts" ADD CONSTRAINT "consent_drafts_tenant_id_encounter_id_fkey" FOREIGN KEY ("tenant_id", "encounter_id") REFERENCES "encounters"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_drafts" ADD CONSTRAINT "consent_drafts_tenant_id_form_definition_id_fkey" FOREIGN KEY ("tenant_id", "form_definition_id") REFERENCES "form_definitions"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_drafts" ADD CONSTRAINT "consent_drafts_tenant_id_consent_id_fkey" FOREIGN KEY ("tenant_id", "consent_id") REFERENCES "consents"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_drafts" ADD CONSTRAINT "consent_drafts_tenant_id_created_by_fkey" FOREIGN KEY ("tenant_id", "created_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_drafts" ADD CONSTRAINT "consent_drafts_tenant_id_staff_witness_user_id_fkey" FOREIGN KEY ("tenant_id", "staff_witness_user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_drafts" ADD CONSTRAINT "consent_drafts_tenant_id_closed_by_fkey" FOREIGN KEY ("tenant_id", "closed_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "patients" FORCE ROW LEVEL SECURITY;
ALTER TABLE "encounters" FORCE ROW LEVEL SECURITY;
ALTER TABLE "form_definitions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "consents" FORCE ROW LEVEL SECURITY;
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;

ALTER TABLE "consent_drafts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "consent_drafts" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "consent_drafts"
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

-- Nilai sah; final wajib tanda tangan pasien/wali + atestasi saksi petugas; batal wajib alasan ≥ 10 (SAFETY_REASON_MIN).
ALTER TABLE "consent_drafts" ADD CONSTRAINT consent_drafts_values_valid CHECK (
  status IN ('draf', 'final', 'ditolak', 'batal')
  AND signer_kind IN ('pasien', 'wali')
  AND char_length(procedure) BETWEEN 1 AND 200
  AND jsonb_typeof(information) = 'array' AND jsonb_array_length(information) = 7
  AND (signer IS NULL OR jsonb_typeof(signer) = 'object')
  AND (family_witness IS NULL OR jsonb_typeof(family_witness) = 'object')
  AND (signer IS NULL) = (signed_at IS NULL)
  AND (staff_witness_user_id IS NULL) = (staff_witnessed_at IS NULL)
  AND (status = 'draf') = (closed_at IS NULL)
  AND (status = 'draf') = (closed_by IS NULL)
  AND (status IN ('final', 'ditolak')) = (consent_id IS NOT NULL)
  AND (status = 'batal') = (cancel_reason IS NOT NULL)
  AND (cancel_reason IS NULL OR char_length(btrim(cancel_reason)) BETWEEN 10 AND 500)
  AND (status <> 'final' OR (signer IS NOT NULL AND staff_witness_user_id IS NOT NULL)));

-- Draf baru selalu `draf` tanpa tanda tangan; setelah ditutup tidak bisa diubah (juga oleh pemilik tabel); tidak
-- dihapus. Waktu tanda tangan, atestasi, dan penutupan dari jam server.
CREATE FUNCTION app_consent_draft_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'APPEND_ONLY: draf persetujuan tidak dihapus; batalkan beralasan' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draf' OR NEW.signer IS NOT NULL OR NEW.staff_witness_user_id IS NOT NULL THEN
      RAISE EXCEPTION 'CONSENT_CLOSED: draf baru tanpa tanda tangan' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status <> 'draf' THEN
    RAISE EXCEPTION 'CONSENT_CLOSED: draf persetujuan sudah ditutup' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.signer IS NOT NULL AND NEW.signer IS DISTINCT FROM OLD.signer THEN
    NEW.signed_at := statement_timestamp();
  END IF;
  IF NEW.staff_witness_user_id IS NOT NULL
     AND (NEW.staff_witness_user_id IS DISTINCT FROM OLD.staff_witness_user_id
          OR NEW.staff_witnessed_at IS DISTINCT FROM OLD.staff_witnessed_at) THEN
    NEW.staff_witnessed_at := statement_timestamp();
  END IF;
  IF NEW.status <> 'draf' THEN
    NEW.closed_at := statement_timestamp();
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER consent_drafts_guard BEFORE INSERT OR UPDATE OR DELETE ON "consent_drafts"
  FOR EACH ROW EXECUTE FUNCTION app_consent_draft_guard();

-- Hak akses: tanpa DELETE; kolom identitas/pembuat beku.
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'simrs_app') THEN
    REVOKE ALL ON "consent_drafts" FROM simrs_app;
    GRANT SELECT, INSERT ON "consent_drafts" TO simrs_app;
    GRANT UPDATE (procedure, signer_kind, information, explained_at, signer, family_witness, signed_at,
                  staff_witness_user_id, staff_witnessed_at, status, consent_id, closed_at, closed_by, cancel_reason,
                  updated_at, updated_by) ON "consent_drafts" TO simrs_app;
  END IF;
END $do$;
