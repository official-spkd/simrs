-- Fase 1 · P05 (potongan 7c): persetujuan privasi pasien. Bagian tengah dibangkitkan prisma migrate diff;
-- bagian bawah manual. NO FORCE sementara pada patients (dirujuk FK baru), dikembalikan di akhir berkas.
ALTER TABLE "patients" NO FORCE ROW LEVEL SECURITY;

-- CreateTable
CREATE TABLE "privacy_consents" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "recipient" TEXT,
    "note" TEXT,
    "given_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "given_by" UUID,
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_by" UUID,
    "revoke_reason" TEXT,

    CONSTRAINT "privacy_consents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "privacy_consents_tenant_id_patient_id_idx" ON "privacy_consents"("tenant_id", "patient_id");

-- CreateIndex
CREATE UNIQUE INDEX "privacy_consents_tenant_id_id_key" ON "privacy_consents"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "privacy_consents" ADD CONSTRAINT "privacy_consents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "privacy_consents" ADD CONSTRAINT "privacy_consents_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================
-- Batasan domain
-- =====================================================================
ALTER TABLE "privacy_consents" ADD CONSTRAINT privacy_consents_kind_valid
  CHECK (kind IN ('umum', 'pembukaan_data'));
ALTER TABLE "privacy_consents" ADD CONSTRAINT privacy_consents_recipient_required
  CHECK (kind <> 'pembukaan_data' OR char_length(recipient) >= 2);
ALTER TABLE "privacy_consents" ADD CONSTRAINT privacy_consents_revoke_valid CHECK (
  (revoked_at IS NULL) = (revoked_by IS NULL)
  AND (revoked_at IS NULL) = (revoke_reason IS NULL)
  AND (revoke_reason IS NULL OR char_length(revoke_reason) BETWEEN 10 AND 300)
  AND (revoked_at IS NULL OR revoked_at >= given_at));
-- Satu persetujuan aktif per jenis (dan per penerima untuk pembukaan data).
CREATE UNIQUE INDEX privacy_consents_one_active
  ON "privacy_consents" ("tenant_id", "patient_id", "kind", (COALESCE(lower("recipient"), '')))
  WHERE revoked_at IS NULL;

-- =====================================================================
-- RLS
-- =====================================================================
ALTER TABLE "privacy_consents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "privacy_consents" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "privacy_consents"
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

-- =====================================================================
-- Hak akses: dicatat sekali, hanya kolom pencabutan yang bisa diisi; tidak ada hapus.
-- =====================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'simrs_app') THEN
    GRANT SELECT, INSERT ON "privacy_consents" TO simrs_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON "privacy_consents" FROM simrs_app;
    GRANT UPDATE (revoked_at, revoked_by, revoke_reason) ON "privacy_consents" TO simrs_app;
  END IF;
END $$;

-- Kembalikan FORCE RLS (lihat catatan di awal berkas).
ALTER TABLE "patients" FORCE ROW LEVEL SECURITY;
