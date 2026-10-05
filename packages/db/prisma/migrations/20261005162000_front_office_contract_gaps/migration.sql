-- Fase 2 · celah skema 0b yang ditemukan kontrak bersama 0a (agen L): data Antrean BPJS di booking, SPRI dan rujukan
-- draf (menunggu nomor), alasan penolakan SEP. Tanpa NO FORCE: tidak ada FK baru.

-- AlterTable
ALTER TABLE "appointments" ADD COLUMN     "jkn_visit_kind" SMALLINT,
ADD COLUMN     "reference_number" TEXT;

-- AlterTable
ALTER TABLE "referrals" ALTER COLUMN "number" DROP NOT NULL;

-- AlterTable
ALTER TABLE "seps" ADD COLUMN     "rejection_reason" TEXT;

-- =====================================================================
-- Booking JKN: jenis kunjungan Antrean (1 rujukan FKTP, 2 rujukan internal, 3 kontrol, 4 rujukan antar-RS) dan
-- nomor referensi wajib untuk keranjang JKN; non-JKN tanpa jenis kunjungan. NOT VALID: baris lama (hanya data uji,
-- belum ada data produksi) tidak divalidasi ulang; semua baris baru/diubah tetap diperiksa.
-- =====================================================================
ALTER TABLE "appointments" ADD CONSTRAINT appointments_jkn_reference CHECK (
  (jkn_visit_kind IS NULL OR jkn_visit_kind BETWEEN 1 AND 4)
  AND (reference_number IS NULL OR char_length(reference_number) BETWEEN 1 AND 40)
  AND (quota_bucket <> 'jkn' OR (jkn_visit_kind IS NOT NULL AND reference_number IS NOT NULL))
  AND (quota_bucket <> 'non_jkn' OR jkn_visit_kind IS NULL)) NOT VALID;

-- =====================================================================
-- Rujukan: jenis `spri` (surat perintah rawat inap), status `pending` (draf terkirim ke BPJS, menunggu nomor).
-- Nomor hanya boleh kosong selama pending; sekali terisi tidak berubah (trigger, juga pemilik tabel).
-- =====================================================================
ALTER TABLE "referrals" DROP CONSTRAINT referrals_valid;
ALTER TABLE "referrals" ADD CONSTRAINT referrals_valid CHECK (
  kind IN ('rujukan-fktp', 'rujukan-rs', 'surat-kontrol', 'rujukan-keluar', 'rujukan-internal', 'spri')
  AND status IN ('pending', 'active', 'used', 'expired', 'cancelled')
  AND (number IS NOT NULL OR status = 'pending')
  AND (number IS NULL OR char_length(number) BETWEEN 3 AND 40)
  AND (valid_until IS NULL OR valid_until >= issued_on)
  AND (visit_no IS NULL OR visit_no >= 1));

CREATE FUNCTION app_referral_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.kind IS DISTINCT FROM OLD.kind OR NEW.patient_id IS DISTINCT FROM OLD.patient_id
     OR (OLD.number IS NOT NULL AND NEW.number IS DISTINCT FROM OLD.number) THEN
    RAISE EXCEPTION 'REFERRAL_IMMUTABLE: jenis, pasien, dan nomor rujukan tidak bisa diubah' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER referrals_guard BEFORE UPDATE ON "referrals"
  FOR EACH ROW EXECUTE FUNCTION app_referral_guard();

-- SEP: alasan penolakan BPJS hanya untuk status gagal (dikosongkan saat dikirim ulang).
ALTER TABLE "seps" ADD CONSTRAINT seps_rejection_valid CHECK (
  rejection_reason IS NULL OR (status = 'failed' AND char_length(rejection_reason) BETWEEN 1 AND 300));

-- =====================================================================
-- Hak kolom aplikasi untuk kolom baru.
-- =====================================================================
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'simrs_app') THEN
    GRANT UPDATE (jkn_visit_kind, reference_number) ON "appointments" TO simrs_app;
    GRANT UPDATE (number) ON "referrals" TO simrs_app;
    GRANT UPDATE (rejection_reason) ON "seps" TO simrs_app;
  END IF;
END $do$;
