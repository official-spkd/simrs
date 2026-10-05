-- Fase 2 potongan 5a · F03/F06 Registrasi rawat jalan + SEP (API).
-- 1. `seps`: status kirim BPJS per baris (insert/update/delete terakhir), catatan SEP, teks diagnosa awal, dan nomor
--    urut pesan outbox (kunci idempotensi `<operasi>:<sep>:<urut>` untuk kirim ulang/tahap lanjutan).
-- 2. `coverages`: no. anggota asuransi/perusahaan (terenkripsi) dan no. surat jaminan.
-- 3. `encounters`: satu kunjungan aktif per booking.
-- 4. `idempotency_keys`: header `Idempotency-Key` untuk tindakan yang tidak boleh terjadi dua kali (registrasi,
--    kelak check-in anjungan), append-only.
-- Tidak ada fungsi SECURITY DEFINER baru. `seps` dan `idempotency_keys` tanpa FK baru ke tabel ber-FORCE lain kecuali
-- `tenants` (registri tanpa FORCE).

-- =====================================================================
-- 1. SEP
-- =====================================================================
ALTER TABLE "seps" ADD COLUMN "sync_status" TEXT NOT NULL DEFAULT 'pending',
ADD COLUMN "synced_at" TIMESTAMPTZ(3),
ADD COLUMN "sync_error_code" TEXT,
ADD COLUMN "sync_seq" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "note" TEXT,
ADD COLUMN "diagnosis_display" TEXT;

-- Penjaga SEP: kolom status kirim (`sync_*`) boleh berubah walau SEP sudah terbit/dibatalkan (hasil hapus/ubah dari
-- BPJS dicatat sesudahnya); isi SEP tetap beku.
CREATE OR REPLACE FUNCTION app_sep_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  trail_cols CONSTANT text[] := ARRAY['updated_at', 'updated_by', 'sync_status', 'synced_at', 'sync_error_code',
                                      'sync_seq'];
  cancel_cols CONSTANT text[] := trail_cols || ARRAY['status', 'cancelled_at', 'cancelled_by', 'cancel_reason'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'SEP_FROZEN: SEP tidak dihapus' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.status = 'cancelled' AND (to_jsonb(NEW) - trail_cols) IS DISTINCT FROM (to_jsonb(OLD) - trail_cols) THEN
    RAISE EXCEPTION 'SEP_FROZEN: SEP % sudah dibatalkan', OLD.sep_no USING ERRCODE = 'P0001';
  END IF;
  IF OLD.status = 'issued' AND (
       (to_jsonb(NEW) - cancel_cols) IS DISTINCT FROM (to_jsonb(OLD) - cancel_cols)
       OR NEW.status NOT IN ('issued', 'cancelled')
       OR (NEW.status = 'issued' AND (to_jsonb(NEW) - trail_cols) IS DISTINCT FROM (to_jsonb(OLD) - trail_cols))) THEN
    RAISE EXCEPTION 'SEP_FROZEN: SEP % sudah terbit; koreksi = versi baru', OLD.sep_no USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $fn$;

-- Isi baris lama (data uji) sesuai statusnya. NO FORCE sementara: pemilik tabel memperbarui semua tenant.
ALTER TABLE "seps" NO FORCE ROW LEVEL SECURITY;
UPDATE "seps" SET
  sync_status = CASE status WHEN 'issued' THEN 'sent' WHEN 'cancelled' THEN 'sent' WHEN 'failed' THEN 'rejected'
                ELSE 'pending' END,
  synced_at = CASE WHEN status IN ('issued', 'cancelled') THEN COALESCE(cancelled_at, issued_at) END
WHERE status <> 'pending';
ALTER TABLE "seps" FORCE ROW LEVEL SECURITY;

ALTER TABLE "seps" ADD CONSTRAINT seps_sync_valid CHECK (
  sync_status IN ('pending', 'sent', 'rejected', 'dead')
  AND (sync_status <> 'sent' OR synced_at IS NOT NULL)
  AND (sync_error_code IS NULL OR char_length(sync_error_code) BETWEEN 3 AND 60)
  AND sync_seq >= 1
  AND (note IS NULL OR char_length(note) <= 200)
  AND (diagnosis_display IS NULL OR char_length(diagnosis_display) BETWEEN 1 AND 200));

-- =====================================================================
-- 2. Penjaminan non-BPJS
-- =====================================================================
ALTER TABLE "coverages" ADD COLUMN "member_no_enc" TEXT,
ADD COLUMN "guarantee_letter_no" TEXT;
ALTER TABLE "coverages" ADD CONSTRAINT coverages_member_valid CHECK (
  (member_no_enc IS NULL OR member_no_enc ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+$')
  AND (guarantee_letter_no IS NULL OR char_length(guarantee_letter_no) BETWEEN 1 AND 60));

-- =====================================================================
-- 3. Satu kunjungan aktif per booking (registrasi ganda/serentak ditolak database)
-- =====================================================================
CREATE UNIQUE INDEX encounters_one_per_appointment
  ON "encounters" ("tenant_id", "appointment_id")
  WHERE appointment_id IS NOT NULL AND status <> 'cancelled';

-- =====================================================================
-- 4. Idempotency-Key
-- =====================================================================
CREATE TABLE "idempotency_keys" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "scope" TEXT NOT NULL,
    "key" UUID NOT NULL,
    "request_hash" TEXT NOT NULL,
    "actor_user_id" UUID,
    "resource_type" TEXT NOT NULL,
    "resource_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "idempotency_keys_tenant_id_id_key" ON "idempotency_keys"("tenant_id", "id");
CREATE UNIQUE INDEX "idempotency_keys_tenant_id_scope_key_key" ON "idempotency_keys"("tenant_id", "scope", "key");

ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "idempotency_keys" ADD CONSTRAINT idempotency_keys_valid CHECK (
  scope ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+){1,3}$'
  AND request_hash ~ '^[0-9a-f]{64}$'
  AND resource_type ~ '^[a-z][a-z0-9_]*$');

CREATE TRIGGER idempotency_keys_append_only BEFORE UPDATE OR DELETE ON "idempotency_keys"
  FOR EACH ROW EXECUTE FUNCTION app_reject_mutation();

ALTER TABLE "idempotency_keys" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "idempotency_keys" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "idempotency_keys"
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

-- =====================================================================
-- Hak akses aplikasi
-- =====================================================================
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'simrs_app') THEN
    -- Status kirim; kelas rawat diisi worker dari kepesertaan sebelum SEP terbit (beku setelahnya, trigger).
    GRANT UPDATE (sync_status, synced_at, sync_error_code, sync_seq, care_class) ON "seps" TO simrs_app;
    GRANT UPDATE (member_no_enc, guarantee_letter_no) ON "coverages" TO simrs_app;
    GRANT SELECT, INSERT ON "idempotency_keys" TO simrs_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON "idempotency_keys" FROM simrs_app;
  END IF;
END $do$;
