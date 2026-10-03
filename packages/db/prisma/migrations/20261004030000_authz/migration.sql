-- Fase 1 · P03 otorisasi: peran, matriks izin, penugasan staf, relasi pasien (ABAC), akses darurat,
-- notifikasi in-app. Bagian tengah dibangkitkan prisma migrate diff; bagian bawah manual.

-- AlterTable
ALTER TABLE "auth_sessions" ADD COLUMN     "assignment_id" UUID;

-- Validasi FK baru menjalankan query sebagai pemilik tabel; pada tabel yang sudah FORCE RLS (dirujuk maupun
-- perujuk) query itu terkena kebijakan RLS dan gagal (app_current_tenant() tanpa konteks). Selama migrasi ini
-- FORCE dimatikan untuk pemilik (migrator) saja; role aplikasi tetap tunduk RLS (ENABLE tidak disentuh).
-- Migrasi berjalan dalam satu transaksi, jadi FORCE pasti kembali menyala atau seluruhnya batal.
ALTER TABLE "users" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "units" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "auth_sessions" NO FORCE ROW LEVEL SECURITY;

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_system" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "tenant_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "resource" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","resource","action")
);

-- CreateTable
CREATE TABLE "staff_assignments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "unit_id" UUID,
    "valid_from" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valid_until" TIMESTAMPTZ(3),
    "end_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "staff_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_relationships" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "valid_from" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valid_until" TIMESTAMPTZ(3),
    "source_type" TEXT,
    "source_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "access_relationships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "break_glass_grants" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "granted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "review_outcome" TEXT,
    "review_note" TEXT,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ(3),

    CONSTRAINT "break_glass_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "recipient_user_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "read_at" TIMESTAMPTZ(3),

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "roles_tenant_id_id_key" ON "roles"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "roles_tenant_id_code_key" ON "roles"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "role_permissions_tenant_id_role_id_idx" ON "role_permissions"("tenant_id", "role_id");

-- CreateIndex
CREATE INDEX "staff_assignments_tenant_id_user_id_idx" ON "staff_assignments"("tenant_id", "user_id");

-- CreateIndex
CREATE INDEX "staff_assignments_tenant_id_role_id_idx" ON "staff_assignments"("tenant_id", "role_id");

-- CreateIndex
CREATE UNIQUE INDEX "staff_assignments_tenant_id_id_key" ON "staff_assignments"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "access_relationships_tenant_id_user_id_patient_id_idx" ON "access_relationships"("tenant_id", "user_id", "patient_id");

-- CreateIndex
CREATE INDEX "break_glass_grants_tenant_id_user_id_patient_id_expires_at_idx" ON "break_glass_grants"("tenant_id", "user_id", "patient_id", "expires_at");

-- CreateIndex
CREATE INDEX "break_glass_grants_tenant_id_review_outcome_idx" ON "break_glass_grants"("tenant_id", "review_outcome");

-- CreateIndex
CREATE INDEX "notifications_tenant_id_recipient_user_id_read_at_idx" ON "notifications"("tenant_id", "recipient_user_id", "read_at");

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_tenant_id_assignment_id_fkey" FOREIGN KEY ("tenant_id", "assignment_id") REFERENCES "staff_assignments"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_tenant_id_role_id_fkey" FOREIGN KEY ("tenant_id", "role_id") REFERENCES "roles"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_assignments" ADD CONSTRAINT "staff_assignments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_assignments" ADD CONSTRAINT "staff_assignments_tenant_id_user_id_fkey" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_assignments" ADD CONSTRAINT "staff_assignments_tenant_id_role_id_fkey" FOREIGN KEY ("tenant_id", "role_id") REFERENCES "roles"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_assignments" ADD CONSTRAINT "staff_assignments_tenant_id_unit_id_fkey" FOREIGN KEY ("tenant_id", "unit_id") REFERENCES "units"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_relationships" ADD CONSTRAINT "access_relationships_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "break_glass_grants" ADD CONSTRAINT "break_glass_grants_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- =====================================================================
-- Batasan domain
-- =====================================================================
ALTER TABLE "roles" ADD CONSTRAINT roles_code_format CHECK (code ~ '^[a-z][a-z0-9_]{2,40}$');
ALTER TABLE "role_permissions" ADD CONSTRAINT role_permissions_scope_valid CHECK (scope IN ('all', 'unit', 'relationship'));
ALTER TABLE "role_permissions" ADD CONSTRAINT role_permissions_format
  CHECK (resource ~ '^[a-z][a-z_.]{1,40}$' AND action ~ '^[a-z][a-z_]{1,20}$');
ALTER TABLE "staff_assignments" ADD CONSTRAINT staff_assignments_period_valid
  CHECK (valid_until IS NULL OR valid_until > valid_from);
ALTER TABLE "access_relationships" ADD CONSTRAINT access_relationships_kind_valid
  CHECK (kind IN ('dpjp', 'perawat_penanggung_jawab', 'rawat_bersama', 'konsultan', 'petugas_unit'));
ALTER TABLE "access_relationships" ADD CONSTRAINT access_relationships_period_valid
  CHECK (valid_until IS NULL OR valid_until > valid_from);
ALTER TABLE "break_glass_grants" ADD CONSTRAINT break_glass_reason_length CHECK (char_length(reason) BETWEEN 20 AND 500);
ALTER TABLE "break_glass_grants" ADD CONSTRAINT break_glass_period_valid CHECK (expires_at > granted_at);
ALTER TABLE "break_glass_grants" ADD CONSTRAINT break_glass_review_valid
  CHECK (review_outcome IS NULL OR review_outcome IN ('sah', 'perlu_klarifikasi'));

-- =====================================================================
-- RLS
-- =====================================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['roles', 'role_permissions', 'staff_assignments', 'access_relationships',
                           'break_glass_grants', 'notifications'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())',
      t);
  END LOOP;
END $$;

-- =====================================================================
-- Hak akses.
-- - role_permissions: matriks diganti utuh (hapus + sisip) saat admin menyimpan; diaudit.
-- - break_glass_grants: hanya kolom tinjauan yang bisa diubah; alasan dan waktu permanen.
-- - notifications: hanya read_at yang bisa diubah.
-- =====================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'simrs_app') THEN
    GRANT SELECT, INSERT, UPDATE ON "roles", "staff_assignments", "access_relationships" TO simrs_app;
    REVOKE DELETE, TRUNCATE ON "roles", "staff_assignments", "access_relationships" FROM simrs_app;
    GRANT SELECT, INSERT, DELETE ON "role_permissions" TO simrs_app;
    REVOKE UPDATE, TRUNCATE ON "role_permissions" FROM simrs_app;

    GRANT SELECT, INSERT ON "break_glass_grants" TO simrs_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON "break_glass_grants" FROM simrs_app;
    GRANT UPDATE (review_outcome, review_note, reviewed_by, reviewed_at) ON "break_glass_grants" TO simrs_app;

    GRANT SELECT, INSERT ON "notifications" TO simrs_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON "notifications" FROM simrs_app;
    GRANT UPDATE (read_at) ON "notifications" TO simrs_app;
  END IF;
END $$;

-- Kembalikan FORCE RLS (lihat catatan di awal berkas).
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;
ALTER TABLE "units" FORCE ROW LEVEL SECURITY;
ALTER TABLE "auth_sessions" FORCE ROW LEVEL SECURITY;
