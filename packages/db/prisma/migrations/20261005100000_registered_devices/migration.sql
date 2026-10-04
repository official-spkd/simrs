-- Fase 1 · P02: PIN perangkat menjadi registri perangkat umum `registered_devices` (jenis `staff_pin`), agar fase 2
-- memakainya ulang untuk prinsipal perangkat anjungan/TV (rencana fase 2, ADR-0027 kelak) tanpa tabel baru.
-- Kolom khusus PIN (akun, posisi, hash PIN) boleh kosong di tingkat tipe; CHECK `registered_devices_staff_pin`
-- mewajibkannya untuk jenis `staff_pin`. Jenis lain cukup menambah nilai di CHECK `registered_devices_kind`.
-- Tanpa NO FORCE: tidak ada FK baru yang divalidasi (hanya ganti nama), CHECK divalidasi tanpa RLS.

ALTER TABLE "pin_devices" RENAME TO "registered_devices";
ALTER TABLE "registered_devices" RENAME CONSTRAINT "pin_devices_pkey" TO "registered_devices_pkey";
ALTER INDEX "pin_devices_token_hash_key" RENAME TO "registered_devices_token_hash_key";
ALTER INDEX "pin_devices_tenant_id_id_key" RENAME TO "registered_devices_tenant_id_id_key";
ALTER INDEX "pin_devices_tenant_id_user_id_idx" RENAME TO "registered_devices_tenant_id_user_id_idx";
ALTER TABLE "registered_devices" RENAME CONSTRAINT "pin_devices_tenant_id_fkey" TO "registered_devices_tenant_id_fkey";
ALTER TABLE "registered_devices" RENAME CONSTRAINT "pin_devices_tenant_id_user_id_fkey" TO "registered_devices_tenant_id_user_id_fkey";
ALTER TABLE "registered_devices" RENAME CONSTRAINT "pin_devices_tenant_id_assignment_id_fkey" TO "registered_devices_tenant_id_assignment_id_fkey";
ALTER TABLE "registered_devices" RENAME CONSTRAINT "pin_devices_tenant_id_revoked_by_fkey" TO "registered_devices_tenant_id_revoked_by_fkey";

ALTER TABLE "auth_sessions" RENAME COLUMN "pin_device_id" TO "device_id";
ALTER TABLE "auth_sessions" RENAME CONSTRAINT "auth_sessions_tenant_id_pin_device_id_fkey" TO "auth_sessions_tenant_id_device_id_fkey";
ALTER INDEX "auth_sessions_tenant_id_pin_device_id_idx" RENAME TO "auth_sessions_tenant_id_device_id_idx";

-- Jenis perangkat; kolom khusus PIN siap kosong untuk jenis lain.
ALTER TABLE "registered_devices" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'staff_pin';
ALTER TABLE "registered_devices" ALTER COLUMN "user_id" DROP NOT NULL,
  ALTER COLUMN "assignment_id" DROP NOT NULL,
  ALTER COLUMN "pin_hash" DROP NOT NULL;

-- =====================================================================
-- Batasan: nama baru, aturan PIN hanya untuk jenis staff_pin
-- =====================================================================
ALTER TABLE "registered_devices" DROP CONSTRAINT "pin_devices_pin_hash_argon2";
ALTER TABLE "registered_devices" DROP CONSTRAINT "pin_devices_window";
ALTER TABLE "registered_devices" RENAME CONSTRAINT "pin_devices_name_length" TO "registered_devices_name_length";
ALTER TABLE "registered_devices" RENAME CONSTRAINT "pin_devices_token_hash_format" TO "registered_devices_token_hash_format";
ALTER TABLE "registered_devices" RENAME CONSTRAINT "pin_devices_failed_attempts" TO "registered_devices_failed_attempts";
ALTER TABLE "registered_devices" RENAME CONSTRAINT "pin_devices_user_agent_length" TO "registered_devices_user_agent_length";
ALTER TABLE "registered_devices" RENAME CONSTRAINT "pin_devices_revoked_consistent" TO "registered_devices_revoked_consistent";
ALTER TABLE "registered_devices" ADD CONSTRAINT registered_devices_kind CHECK (kind IN ('staff_pin'));
ALTER TABLE "registered_devices" ADD CONSTRAINT registered_devices_pin_hash_argon2
  CHECK (pin_hash IS NULL OR pin_hash LIKE '$argon2id$%');
ALTER TABLE "registered_devices" ADD CONSTRAINT registered_devices_window CHECK (expires_at > created_at);
-- PIN: milik satu akun, membuka satu posisi, PIN argon2id, masa berlaku maks. 30 hari (ADR-0024).
ALTER TABLE "registered_devices" ADD CONSTRAINT registered_devices_staff_pin CHECK (
  kind <> 'staff_pin' OR (
    user_id IS NOT NULL AND assignment_id IS NOT NULL AND pin_hash IS NOT NULL
    AND expires_at <= created_at + interval '30 days'));

-- Penjaga: jenis dan isi perangkat tidak berubah; yang sudah dicabut final.
DROP TRIGGER "pin_devices_guard" ON "registered_devices";
DROP FUNCTION app_pin_device_guard();
CREATE FUNCTION app_registered_device_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  mutable CONSTANT text[] := ARRAY['failed_attempts', 'last_used_at', 'revoked_at', 'revoked_reason', 'revoked_by'];
BEGIN
  IF OLD.revoked_at IS NOT NULL OR (to_jsonb(NEW) - mutable) IS DISTINCT FROM (to_jsonb(OLD) - mutable) THEN
    RAISE EXCEPTION 'DEVICE_IMMUTABLE: perangkat terdaftar % tidak bisa diubah', OLD.id USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER registered_devices_guard
  BEFORE UPDATE ON "registered_devices"
  FOR EACH ROW EXECUTE FUNCTION app_registered_device_guard();

-- RLS (kebijakan tenant_isolation ikut berganti nama tabel) dan hak kolom tetap; `kind` tidak bisa diubah aplikasi.
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'simrs_app') THEN
    REVOKE UPDATE (kind) ON "registered_devices" FROM simrs_app;
  END IF;
END $do$;
