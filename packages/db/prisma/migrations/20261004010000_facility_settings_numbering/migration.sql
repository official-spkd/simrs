-- Fase 1 · P01 struktur faskes, P10 modul aktif, P12 pengaturan, P08 penomoran.
-- Bagian tengah dibangkitkan `prisma migrate diff`; bagian bawah (CHECK, RLS, GRANT) manual.
-- FK antar-tabel domain memakai pasangan (tenant_id, id): FK tidak tunduk RLS, jadi tanpa ini sebuah baris
-- bisa menunjuk (dan memastikan keberadaan) baris milik tenant lain.

-- CreateTable
CREATE TABLE "facilities" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kemenkes_code" TEXT,
    "address" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "facilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "units" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "parent_id" UUID,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "locations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "unit_id" UUID NOT NULL,
    "parent_id" UUID,
    "kind" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "care_class" TEXT,
    "satusehat_location_id" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_modules" (
    "tenant_id" UUID NOT NULL,
    "module_code" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "tenant_modules_pkey" PRIMARY KEY ("tenant_id","module_code")
);

-- CreateTable
CREATE TABLE "tenant_settings" (
    "tenant_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "tenant_settings_pkey" PRIMARY KEY ("tenant_id","key")
);

-- CreateTable
CREATE TABLE "number_sequences" (
    "tenant_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "last_value" BIGINT NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "number_sequences_pkey" PRIMARY KEY ("tenant_id","kind","period")
);

-- CreateIndex
CREATE UNIQUE INDEX "facilities_tenant_id_id_key" ON "facilities"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "facilities_tenant_id_code_key" ON "facilities"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "units_tenant_id_facility_id_idx" ON "units"("tenant_id", "facility_id");

-- CreateIndex
CREATE UNIQUE INDEX "units_tenant_id_id_key" ON "units"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "units_tenant_id_code_key" ON "units"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "locations_tenant_id_unit_id_idx" ON "locations"("tenant_id", "unit_id");

-- CreateIndex
CREATE UNIQUE INDEX "locations_tenant_id_id_key" ON "locations"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "locations_tenant_id_code_key" ON "locations"("tenant_id", "code");

-- AddForeignKey
ALTER TABLE "facilities" ADD CONSTRAINT "facilities_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "units" ADD CONSTRAINT "units_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "units" ADD CONSTRAINT "units_tenant_id_facility_id_fkey" FOREIGN KEY ("tenant_id", "facility_id") REFERENCES "facilities"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "units" ADD CONSTRAINT "units_tenant_id_parent_id_fkey" FOREIGN KEY ("tenant_id", "parent_id") REFERENCES "units"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_tenant_id_unit_id_fkey" FOREIGN KEY ("tenant_id", "unit_id") REFERENCES "units"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_tenant_id_parent_id_fkey" FOREIGN KEY ("tenant_id", "parent_id") REFERENCES "locations"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_modules" ADD CONSTRAINT "tenant_modules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "number_sequences" ADD CONSTRAINT "number_sequences_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- =====================================================================
-- Batasan domain (pertahanan berlapis selain validasi zod di API)
-- =====================================================================
ALTER TABLE "facilities" ADD CONSTRAINT facilities_code_format CHECK (code ~ '^[A-Z0-9][A-Z0-9-]{0,29}$');
ALTER TABLE "units" ADD CONSTRAINT units_code_format CHECK (code ~ '^[A-Z0-9][A-Z0-9-]{0,29}$');
ALTER TABLE "units" ADD CONSTRAINT units_kind_valid CHECK (kind IN
  ('instalasi', 'poli', 'igd', 'rawat_inap', 'penunjang', 'farmasi', 'kamar_operasi', 'administrasi'));
ALTER TABLE "units" ADD CONSTRAINT units_not_own_parent CHECK (parent_id IS NULL OR parent_id <> id);
ALTER TABLE "locations" ADD CONSTRAINT locations_code_format CHECK (code ~ '^[A-Z0-9][A-Z0-9-]{0,29}$');
ALTER TABLE "locations" ADD CONSTRAINT locations_kind_valid CHECK (kind IN ('ruang', 'kamar', 'bed'));
ALTER TABLE "locations" ADD CONSTRAINT locations_bed_has_parent CHECK (kind <> 'bed' OR parent_id IS NOT NULL);
ALTER TABLE "locations" ADD CONSTRAINT locations_not_own_parent CHECK (parent_id IS NULL OR parent_id <> id);
ALTER TABLE "locations" ADD CONSTRAINT locations_care_class_valid CHECK (care_class IS NULL OR care_class IN
  ('vvip', 'vip', 'kelas_1', 'kelas_2', 'kelas_3', 'icu', 'hcu', 'nicu', 'picu', 'isolasi', 'tanpa_kelas'));
ALTER TABLE "tenant_modules" ADD CONSTRAINT tenant_modules_code_format CHECK (module_code ~ '^[PFKSUBI][0-9]{2}$');
ALTER TABLE "tenant_settings" ADD CONSTRAINT tenant_settings_key_format CHECK (key ~ '^[a-z][a-z0-9_.]{2,63}$');
ALTER TABLE "number_sequences" ADD CONSTRAINT number_sequences_kind_format CHECK (kind ~ '^[a-z][a-z0-9_]{1,40}$');
ALTER TABLE "number_sequences" ADD CONSTRAINT number_sequences_period_format CHECK (period ~ '^(|[0-9]{4}|[0-9]{6})$');
ALTER TABLE "number_sequences" ADD CONSTRAINT number_sequences_positive CHECK (last_value > 0);

-- =====================================================================
-- RLS (ADR-0002, ADR-0008)
-- =====================================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['facilities', 'units', 'locations', 'tenant_modules', 'tenant_settings', 'number_sequences'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())',
      t);
  END LOOP;
END $$;

-- =====================================================================
-- Hak akses: master dan konfigurasi tidak dihapus (dinonaktifkan/ditimpa). DELETE dicabut eksplisit karena
-- default privileges di init.sql memberikannya otomatis untuk tabel baru.
-- =====================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'simrs_app') THEN
    GRANT SELECT, INSERT, UPDATE ON "facilities", "units", "locations", "tenant_modules", "tenant_settings", "number_sequences" TO simrs_app;
    REVOKE DELETE, TRUNCATE ON "facilities", "units", "locations", "tenant_modules", "tenant_settings", "number_sequences" FROM simrs_app;
  END IF;
END $$;
