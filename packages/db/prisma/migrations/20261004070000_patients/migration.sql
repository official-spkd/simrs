-- Fase 1 · P05 Master Patient Index (potongan 7a): pasien + identifier terenkripsi, FK relasi/akses darurat
-- ke pasien. Bagian tengah dibangkitkan prisma migrate diff; bagian bawah manual.
--
-- FK dari access_relationships dan break_glass_grants ke patients dipasang NOT VALID: baris lama di basis data
-- lokal/tes (dibuat sebelum tabel pasien ada) merujuk ID pasien acak. Baris baru tetap diperiksa penuh.
-- Produksi belum punya baris di kedua tabel; VALIDATE CONSTRAINT bisa dijalankan bila diperlukan.
-- NO FORCE sementara untuk pemilik (lihat migrasi 20261004030000), dikembalikan di akhir berkas.
ALTER TABLE "access_relationships" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "break_glass_grants" NO FORCE ROW LEVEL SECURITY;

-- CreateTable
CREATE TABLE "patients" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "mrn" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_search" TEXT NOT NULL,
    "sex" TEXT NOT NULL,
    "birth_date" DATE,
    "birth_date_estimated" BOOLEAN NOT NULL DEFAULT false,
    "mother_name" TEXT,
    "address_enc" TEXT,
    "phone_enc" TEXT,
    "phone_hash" TEXT,
    "unidentified" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'active',
    "merged_into_id" UUID,
    "merged_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "patients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_identifiers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "system" TEXT NOT NULL,
    "value_enc" TEXT NOT NULL,
    "value_hash" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "verification_status" TEXT NOT NULL DEFAULT 'unverified',
    "verified_at" TIMESTAMPTZ(3),
    "verification_details" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "deactivated_at" TIMESTAMPTZ(3),
    "deactivated_by" UUID,
    "deactivation_reason" TEXT,

    CONSTRAINT "patient_identifiers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "patients_tenant_id_birth_date_idx" ON "patients"("tenant_id", "birth_date");

-- CreateIndex
CREATE INDEX "patients_tenant_id_phone_hash_idx" ON "patients"("tenant_id", "phone_hash");

-- CreateIndex
CREATE INDEX "patients_tenant_id_merged_into_id_idx" ON "patients"("tenant_id", "merged_into_id");

-- CreateIndex
CREATE UNIQUE INDEX "patients_tenant_id_id_key" ON "patients"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "patients_tenant_id_mrn_key" ON "patients"("tenant_id", "mrn");

-- CreateIndex
CREATE INDEX "patient_identifiers_tenant_id_system_value_hash_idx" ON "patient_identifiers"("tenant_id", "system", "value_hash");

-- CreateIndex
CREATE INDEX "patient_identifiers_tenant_id_patient_id_idx" ON "patient_identifiers"("tenant_id", "patient_id");

-- CreateIndex
CREATE UNIQUE INDEX "patient_identifiers_tenant_id_id_key" ON "patient_identifiers"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "access_relationships_tenant_id_patient_id_idx" ON "access_relationships"("tenant_id", "patient_id");

-- AddForeignKey
ALTER TABLE "access_relationships" ADD CONSTRAINT "access_relationships_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

-- AddForeignKey
ALTER TABLE "break_glass_grants" ADD CONSTRAINT "break_glass_grants_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

-- AddForeignKey
ALTER TABLE "patients" ADD CONSTRAINT "patients_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patients" ADD CONSTRAINT "patients_tenant_id_merged_into_id_fkey" FOREIGN KEY ("tenant_id", "merged_into_id") REFERENCES "patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_identifiers" ADD CONSTRAINT "patient_identifiers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_identifiers" ADD CONSTRAINT "patient_identifiers_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================
-- Batasan domain
-- =====================================================================
ALTER TABLE "patients" ADD CONSTRAINT patients_sex_valid CHECK (sex IN ('male', 'female', 'unknown'));
ALTER TABLE "patients" ADD CONSTRAINT patients_status_valid CHECK (status IN ('active', 'merged'));
ALTER TABLE "patients" ADD CONSTRAINT patients_merge_consistent CHECK (
  (status = 'merged') = (merged_into_id IS NOT NULL)
  AND (merged_into_id IS NULL) = (merged_at IS NULL)
  AND (merged_into_id IS NULL OR merged_into_id <> id));
ALTER TABLE "patients" ADD CONSTRAINT patients_mrn_format CHECK (mrn ~ '^[0-9]{2}-[0-9]{2}-[0-9]{2}-[0-9]{2}$');
ALTER TABLE "patients" ADD CONSTRAINT patients_name_length CHECK (char_length(name) BETWEEN 2 AND 120);
ALTER TABLE "patients" ADD CONSTRAINT patients_name_search_present CHECK (char_length(name_search) >= 1);
ALTER TABLE "patients" ADD CONSTRAINT patients_birth_date_valid CHECK (
  (birth_date IS NULL OR birth_date >= DATE '1900-01-01') AND (unidentified OR birth_date IS NOT NULL));
-- Kolom terenkripsi hanya menerima format `v1.…` (pengaman bila kode lupa mengenkripsi).
ALTER TABLE "patients" ADD CONSTRAINT patients_encrypted_columns CHECK (
  (address_enc IS NULL OR address_enc LIKE 'v1.%') AND (phone_enc IS NULL OR phone_enc LIKE 'v1.%')
  AND (phone_hash IS NULL OR phone_hash ~ '^[0-9a-f]{64}$') AND ((phone_enc IS NULL) = (phone_hash IS NULL)));

ALTER TABLE "patient_identifiers" ADD CONSTRAINT patient_identifiers_system_valid
  CHECK (system IN ('nik', 'bpjs', 'ihs', 'paspor'));
ALTER TABLE "patient_identifiers" ADD CONSTRAINT patient_identifiers_verification_valid
  CHECK (verification_status IN ('unverified', 'pending', 'verified', 'mismatch', 'not_found'));
ALTER TABLE "patient_identifiers" ADD CONSTRAINT patient_identifiers_encrypted
  CHECK (value_enc LIKE 'v1.%' AND value_hash ~ '^[0-9a-f]{64}$');
ALTER TABLE "patient_identifiers" ADD CONSTRAINT patient_identifiers_deactivation_valid CHECK (
  (active AND deactivated_at IS NULL AND deactivated_by IS NULL AND deactivation_reason IS NULL)
  OR (NOT active AND deactivated_at IS NOT NULL AND char_length(deactivation_reason) >= 5));

-- Satu identifier aktif per sistem per pasien (nilai lama tetap tersimpan nonaktif).
CREATE UNIQUE INDEX patient_identifiers_one_active_per_system
  ON "patient_identifiers" ("tenant_id", "patient_id", "system") WHERE active;

-- Pencarian nama mirip (pg_trgm) per tenant (btree_gin untuk kolom tenant_id).
CREATE INDEX patients_name_search_trgm ON "patients" USING gin ("tenant_id", "name_search" gin_trgm_ops);

-- =====================================================================
-- RLS
-- =====================================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['patients', 'patient_identifiers'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())',
      t);
  END LOOP;
END $$;

-- =====================================================================
-- Hak akses (tidak ada hapus untuk data pasien, docs/04 §1).
-- - patients: nomor RM, waktu dan pembuat tidak bisa diubah; selebihnya diubah lewat API (diaudit).
-- - patient_identifiers: nilai permanen; hanya status aktif/nonaktif dan hasil verifikasi yang berubah.
-- =====================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'simrs_app') THEN
    GRANT SELECT, INSERT ON "patients", "patient_identifiers" TO simrs_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON "patients", "patient_identifiers" FROM simrs_app;
    GRANT UPDATE (name, name_search, sex, birth_date, birth_date_estimated, mother_name, address_enc, phone_enc,
                  phone_hash, unidentified, status, merged_into_id, merged_at, updated_at, updated_by)
      ON "patients" TO simrs_app;
    GRANT UPDATE (active, verification_status, verified_at, verification_details, deactivated_at, deactivated_by,
                  deactivation_reason)
      ON "patient_identifiers" TO simrs_app;
  END IF;
END $$;

-- Kembalikan FORCE RLS (lihat catatan di awal berkas).
ALTER TABLE "access_relationships" FORCE ROW LEVEL SECURITY;
ALTER TABLE "break_glass_grants" FORCE ROW LEVEL SECURITY;
