-- Fase 1 · P02: PIN masuk cepat per perangkat terdaftar (docs/05 §1, ADR-0024).
-- Validasi FK ke/dari tabel ber-FORCE RLS tidak punya konteks tenant (gagal TENANT_REQUIRED), jadi FORCE dimatikan
-- sementara pada tabel yang dirujuk/merujuk FK baru; seluruh migrasi satu transaksi, dikembalikan di akhir berkas.
ALTER TABLE "users" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "staff_assignments" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "auth_sessions" NO FORCE ROW LEVEL SECURITY;

-- AlterTable
ALTER TABLE "auth_sessions" ADD COLUMN     "pin_device_id" UUID;

-- CreateTable
CREATE TABLE "pin_devices" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "pin_hash" TEXT NOT NULL,
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "last_used_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_reason" TEXT,
    "revoked_by" UUID,

    CONSTRAINT "pin_devices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "auth_sessions_tenant_id_pin_device_id_idx" ON "auth_sessions"("tenant_id", "pin_device_id");

-- CreateIndex
CREATE UNIQUE INDEX "pin_devices_token_hash_key" ON "pin_devices"("token_hash");

-- CreateIndex
CREATE INDEX "pin_devices_tenant_id_user_id_idx" ON "pin_devices"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "pin_devices_tenant_id_id_key" ON "pin_devices"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_tenant_id_pin_device_id_fkey" FOREIGN KEY ("tenant_id", "pin_device_id") REFERENCES "pin_devices"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pin_devices" ADD CONSTRAINT "pin_devices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pin_devices" ADD CONSTRAINT "pin_devices_tenant_id_user_id_fkey" FOREIGN KEY ("tenant_id", "user_id") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pin_devices" ADD CONSTRAINT "pin_devices_tenant_id_assignment_id_fkey" FOREIGN KEY ("tenant_id", "assignment_id") REFERENCES "staff_assignments"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pin_devices" ADD CONSTRAINT "pin_devices_tenant_id_revoked_by_fkey" FOREIGN KEY ("tenant_id", "revoked_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- =====================================================================
-- Batasan (angka sama dengan @simrs/shared pin-policy)
-- =====================================================================
ALTER TABLE "pin_devices" ADD CONSTRAINT pin_devices_name_length CHECK (char_length(name) BETWEEN 3 AND 60);
ALTER TABLE "pin_devices" ADD CONSTRAINT pin_devices_token_hash_format CHECK (token_hash ~ '^[a-f0-9]{64}$');
ALTER TABLE "pin_devices" ADD CONSTRAINT pin_devices_pin_hash_argon2 CHECK (pin_hash LIKE '$argon2id$%');
ALTER TABLE "pin_devices" ADD CONSTRAINT pin_devices_failed_attempts CHECK (failed_attempts BETWEEN 0 AND 5);
ALTER TABLE "pin_devices" ADD CONSTRAINT pin_devices_window
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '30 days');
ALTER TABLE "pin_devices" ADD CONSTRAINT pin_devices_user_agent_length
  CHECK (user_agent IS NULL OR char_length(user_agent) <= 200);
ALTER TABLE "pin_devices" ADD CONSTRAINT pin_devices_revoked_consistent CHECK (
  (revoked_at IS NULL) = (revoked_reason IS NULL)
  AND (revoked_by IS NULL OR revoked_at IS NOT NULL)
  AND (revoked_reason IS NULL OR revoked_reason IN ('user_removed', 'admin_revoked', 'too_many_attempts',
    'password_changed', 'password_reset', 'mfa_reset', 'user_disabled', 'assignment_ended')));

-- Hanya penanda pakai, hitungan salah, dan pencabutan yang boleh berubah; PIN yang sudah dicabut final (daftar
-- ulang = token + PIN baru), juga bagi pemilik tabel.
CREATE FUNCTION app_pin_device_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  mutable CONSTANT text[] := ARRAY['failed_attempts', 'last_used_at', 'revoked_at', 'revoked_reason', 'revoked_by'];
BEGIN
  IF OLD.revoked_at IS NOT NULL OR (to_jsonb(NEW) - mutable) IS DISTINCT FROM (to_jsonb(OLD) - mutable) THEN
    RAISE EXCEPTION 'PIN_DEVICE_IMMUTABLE: PIN perangkat % tidak bisa diubah', OLD.id USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER pin_devices_guard
  BEFORE UPDATE ON "pin_devices"
  FOR EACH ROW EXECUTE FUNCTION app_pin_device_guard();

-- =====================================================================
-- RLS + hak akses: sisip/baca; ubah hanya kolom di atas; tidak dihapus (jejak).
-- =====================================================================
ALTER TABLE "pin_devices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pin_devices" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "pin_devices"
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'simrs_app') THEN
    GRANT SELECT, INSERT ON "pin_devices" TO simrs_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON "pin_devices" FROM simrs_app;
    GRANT UPDATE (failed_attempts, last_used_at, revoked_at, revoked_reason, revoked_by) ON "pin_devices" TO simrs_app;
  END IF;
END $do$;

-- Kembalikan FORCE RLS (lihat catatan di awal berkas).
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;
ALTER TABLE "staff_assignments" FORCE ROW LEVEL SECURITY;
ALTER TABLE "auth_sessions" FORCE ROW LEVEL SECURITY;
