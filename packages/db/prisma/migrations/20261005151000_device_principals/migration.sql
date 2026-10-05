-- Fase 2 · potongan 1b · ADR-0027: prinsipal perangkat anjungan (`kiosk`, F05) dan display TV (`queue_display`, F04) di
-- tabel umum `registered_devices` (ADR-0024 §10). Perangkat didaftarkan admin per unit; perangkat menukar kode
-- pendaftaran sekali pakai (HMAC, 15 menit) dengan token `dv1` miliknya sendiri. Tanpa akun staf.
-- Validasi FK ke/dari tabel ber-FORCE RLS tidak punya konteks tenant, jadi FORCE dimatikan sementara pada tabel yang
-- dirujuk/merujuk FK baru; seluruh migrasi satu transaksi, dikembalikan di akhir berkas.
ALTER TABLE "registered_devices" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "units" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "users" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "queue_displays" NO FORCE ROW LEVEL SECURITY;

-- AlterTable
ALTER TABLE "registered_devices" ALTER COLUMN "token_hash" DROP NOT NULL,
ADD COLUMN     "created_by" UUID,
ADD COLUMN     "enrol_code_hash" TEXT,
ADD COLUMN     "enrol_expires_at" TIMESTAMPTZ(3),
ADD COLUMN     "enrolled_at" TIMESTAMPTZ(3),
ADD COLUMN     "queue_display_id" UUID,
ADD COLUMN     "unit_id" UUID;

-- CreateIndex
CREATE INDEX "registered_devices_tenant_id_kind_unit_id_idx" ON "registered_devices"("tenant_id", "kind", "unit_id");

-- AddForeignKey
ALTER TABLE "registered_devices" ADD CONSTRAINT "registered_devices_tenant_id_unit_id_fkey" FOREIGN KEY ("tenant_id", "unit_id") REFERENCES "units"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "registered_devices_tenant_id_queue_display_id_idx" ON "registered_devices"("tenant_id", "queue_display_id");

-- AddForeignKey: display → papan antrean (tabel `queue_displays` dari potongan 0b).
ALTER TABLE "registered_devices" ADD CONSTRAINT "registered_devices_tenant_id_queue_display_id_fkey" FOREIGN KEY ("tenant_id", "queue_display_id") REFERENCES "queue_displays"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registered_devices" ADD CONSTRAINT "registered_devices_tenant_id_created_by_fkey" FOREIGN KEY ("tenant_id", "created_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Kode pendaftaran unik per tenant selama masih bisa dipakai (dicari lewat HMAC-nya).
CREATE UNIQUE INDEX registered_devices_enrol_code ON "registered_devices" (tenant_id, enrol_code_hash)
  WHERE enrol_code_hash IS NOT NULL;

-- =====================================================================
-- Batasan
-- =====================================================================
ALTER TABLE "registered_devices" DROP CONSTRAINT registered_devices_kind;
ALTER TABLE "registered_devices" ADD CONSTRAINT registered_devices_kind CHECK (kind IN ('staff_pin', 'kiosk', 'queue_display'));
-- PIN tetap wajib bertoken (ADR-0024); hanya perangkat prinsipal yang boleh menunggu pendaftaran.
ALTER TABLE "registered_devices" ADD CONSTRAINT registered_devices_staff_pin_token CHECK (
  kind <> 'staff_pin' OR (token_hash IS NOT NULL AND unit_id IS NULL AND enrol_code_hash IS NULL
    AND enrolled_at IS NULL));
-- HMAC kode berversi seperti blind index lain (kunci `v1` = 64 hex, kunci lain `vN:` + 64 hex; ADR-0015 rotasi kunci).
ALTER TABLE "registered_devices" ADD CONSTRAINT registered_devices_enrol_code_format
  CHECK (enrol_code_hash IS NULL OR enrol_code_hash ~ '^(v[1-9][0-9]{0,2}:)?[a-f0-9]{64}$');
-- Anjungan/display: terikat unit, tanpa akun/posisi/PIN, kredensial maks. 366 hari, kode pendaftaran maks. 1 hari;
-- bertoken tepat saat sudah mendaftar; kode dibuang saat mendaftar.
ALTER TABLE "registered_devices" ADD CONSTRAINT registered_devices_principal CHECK (
  kind NOT IN ('kiosk', 'queue_display') OR (
    unit_id IS NOT NULL AND user_id IS NULL AND assignment_id IS NULL AND pin_hash IS NULL
    AND expires_at <= created_at + interval '366 days'
    AND enrol_expires_at IS NOT NULL AND enrol_expires_at > created_at
    AND enrol_expires_at <= created_at + interval '1 day'
    AND (token_hash IS NULL) = (enrolled_at IS NULL)
    AND (enrolled_at IS NULL OR (enrol_code_hash IS NULL AND enrolled_at <= enrol_expires_at))
    AND (enrolled_at IS NOT NULL OR enrol_code_hash IS NOT NULL OR revoked_at IS NOT NULL)));
ALTER TABLE "registered_devices" ADD CONSTRAINT registered_devices_queue_display
  CHECK (queue_display_id IS NULL OR kind = 'queue_display');

-- Penjaga: selain kolom pakai/pencabutan, perangkat hanya berubah SEKALI saat mendaftar (token + waktu daftar terisi,
-- kode dibuang, user agent dicatat) dan hanya sebelum kode kedaluwarsa. Yang sudah dicabut final.
CREATE OR REPLACE FUNCTION app_registered_device_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  mutable CONSTANT text[] := ARRAY['failed_attempts', 'last_used_at', 'revoked_at', 'revoked_reason', 'revoked_by'];
  enrolment CONSTANT text[] := ARRAY['token_hash', 'enrolled_at', 'enrol_code_hash', 'user_agent'];
BEGIN
  IF OLD.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'DEVICE_IMMUTABLE: perangkat terdaftar % tidak bisa diubah', OLD.id USING ERRCODE = 'P0001';
  END IF;
  IF OLD.enrolled_at IS NULL AND NEW.enrolled_at IS NOT NULL THEN
    IF OLD.kind NOT IN ('kiosk', 'queue_display') OR OLD.enrol_code_hash IS NULL OR NEW.enrol_code_hash IS NOT NULL
       OR NEW.token_hash IS NULL OR now() > OLD.enrol_expires_at
       OR (to_jsonb(NEW) - mutable - enrolment) IS DISTINCT FROM (to_jsonb(OLD) - mutable - enrolment) THEN
      RAISE EXCEPTION 'DEVICE_IMMUTABLE: pendaftaran perangkat % tidak sah', OLD.id USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - mutable) IS DISTINCT FROM (to_jsonb(OLD) - mutable) THEN
    RAISE EXCEPTION 'DEVICE_IMMUTABLE: perangkat terdaftar % tidak bisa diubah', OLD.id USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $fn$;

-- Hak kolom: aplikasi boleh mengisi kolom pendaftaran (penjaga di atas membatasi kapan).
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'simrs_app') THEN
    GRANT UPDATE (token_hash, enrolled_at, enrol_code_hash, user_agent) ON "registered_devices" TO simrs_app;
  END IF;
END $do$;

-- Kembalikan FORCE RLS (lihat catatan di awal berkas).
ALTER TABLE "registered_devices" FORCE ROW LEVEL SECURITY;
ALTER TABLE "units" FORCE ROW LEVEL SECURITY;
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;
ALTER TABLE "queue_displays" FORCE ROW LEVEL SECURITY;
