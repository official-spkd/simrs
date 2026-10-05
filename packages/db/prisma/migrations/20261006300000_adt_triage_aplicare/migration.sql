-- Fase 3 · potongan 3.3 · ADT, papan bed, triase IGD, Aplicare (K03, K04, K05). Bagian tengah dibangkitkan prisma
-- migrate diff; bawah manual. NO FORCE sementara pada tabel yang dirujuk FK baru, dikembalikan di akhir berkas.
ALTER TABLE "units" NO FORCE ROW LEVEL SECURITY;

-- AlterTable
ALTER TABLE "encounters" ADD COLUMN     "disposition" TEXT;

-- CreateTable
CREATE TABLE "aplicare_rooms" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "unit_id" UUID NOT NULL,
    "care_class" TEXT NOT NULL,
    "room_code" TEXT NOT NULL,
    "room_name" TEXT NOT NULL,
    "class_code" TEXT,
    "registered_at" TIMESTAMPTZ(3),
    "revision" INTEGER NOT NULL DEFAULT 0,
    "sent_revision" INTEGER NOT NULL DEFAULT 0,
    "last_error_code" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "aplicare_rooms_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "aplicare_rooms_tenant_id_id_key" ON "aplicare_rooms"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "aplicare_rooms_tenant_id_unit_id_care_class_key" ON "aplicare_rooms"("tenant_id", "unit_id", "care_class");

-- CreateIndex
CREATE UNIQUE INDEX "aplicare_rooms_tenant_id_room_code_key" ON "aplicare_rooms"("tenant_id", "room_code");

-- AddForeignKey
ALTER TABLE "aplicare_rooms" ADD CONSTRAINT "aplicare_rooms_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aplicare_rooms" ADD CONSTRAINT "aplicare_rooms_tenant_id_unit_id_fkey" FOREIGN KEY ("tenant_id", "unit_id") REFERENCES "units"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================
-- Disposisi kunjungan (cara keluar). IGD yang dilanjutkan admisi = `rawat_inap` (keputusan fase 3 no. 7).
-- =====================================================================
ALTER TABLE "encounters" ADD CONSTRAINT encounters_disposition_valid CHECK (
  disposition IS NULL OR (
    disposition IN ('pulang', 'rujuk', 'pulang_paksa', 'meninggal', 'pindah_rawat', 'rawat_inap')
    AND status = 'finished'
    AND (disposition <> 'rawat_inap' OR class = 'EMER')));

-- =====================================================================
-- Ruang Aplicare
-- =====================================================================
ALTER TABLE "aplicare_rooms" ADD CONSTRAINT aplicare_rooms_values_valid CHECK (
  care_class ~ '^[a-z][a-z0-9_]{1,30}$'
  AND room_code ~ '^[A-Z0-9-]{1,20}$'
  AND char_length(room_name) BETWEEN 1 AND 100
  AND (class_code IS NULL OR char_length(class_code) BETWEEN 1 AND 10)
  AND revision >= 0 AND sent_revision >= 0 AND sent_revision <= revision);
-- Unit, kelas, dan kode ruang tetap; tidak dihapus.
CREATE TRIGGER aplicare_rooms_immutable BEFORE UPDATE ON "aplicare_rooms"
  FOR EACH ROW EXECUTE FUNCTION app_immutable_columns('unit_id', 'care_class', 'room_code', 'created_at');
CREATE TRIGGER aplicare_rooms_no_delete BEFORE DELETE ON "aplicare_rooms"
  FOR EACH ROW EXECUTE FUNCTION app_reject_mutation();

ALTER TABLE "aplicare_rooms" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "aplicare_rooms" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "aplicare_rooms"
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'simrs_app') THEN
    GRANT UPDATE (disposition) ON "encounters" TO simrs_app;
    GRANT SELECT, INSERT ON "aplicare_rooms" TO simrs_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON "aplicare_rooms" FROM simrs_app;
    GRANT UPDATE (room_name, class_code, registered_at, revision, sent_revision, last_error_code, updated_at)
      ON "aplicare_rooms" TO simrs_app;
  END IF;
END $do$;

ALTER TABLE "units" FORCE ROW LEVEL SECURITY;
