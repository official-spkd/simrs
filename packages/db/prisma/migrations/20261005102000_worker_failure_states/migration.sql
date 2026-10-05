-- Fase 2 · potongan 0b, untuk infrastruktur worker (potongan 1a): keadaan gagal permanen yang terlihat di domain
-- dan kirim ulang manual dari DLQ.
-- 1. Tanda tangan TTE: status `failed` (diisi `tte.sign.onDead`); hanya pending → failed dan failed → pending
--    (kirim ulang) yang diizinkan, selain pending → signed. Tanda tangan `signed` tetap final.
-- 2. Identifier pasien: status verifikasi `error` (Dukcapil gagal permanen).
-- 3. Outbox: `requeued_at` (kirim ulang manual) agar jendela retry hari layanan dihitung ulang dari waktu itu.
-- CHECK baru divalidasi tanpa RLS (bukan query), jadi tidak perlu NO FORCE.

ALTER TABLE "document_signatures" DROP CONSTRAINT document_signatures_status_valid;
ALTER TABLE "document_signatures" ADD CONSTRAINT document_signatures_status_valid
  CHECK (status IN ('pending', 'signed', 'failed'));

CREATE OR REPLACE FUNCTION app_document_signature_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  mutable CONSTANT text[] := ARRAY['status', 'signed_at', 'provider_signature_id', 'certificate', 'signature'];
  doc_sha text;
  doc_voided timestamptz;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'SIGNATURE_IMMUTABLE: tanda tangan tidak dihapus' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT d.sha256, d.voided_at INTO doc_sha, doc_voided
      FROM documents d WHERE d.tenant_id = NEW.tenant_id AND d.id = NEW.document_id FOR SHARE;
    IF doc_voided IS NOT NULL THEN
      RAISE EXCEPTION 'DOCUMENT_VOIDED: dokumen batal tidak bisa ditandatangani' USING ERRCODE = 'P0001';
    END IF;
    IF doc_sha IS DISTINCT FROM NEW.document_sha256 THEN
      RAISE EXCEPTION 'SIGNATURE_HASH_MISMATCH: hash tanda tangan berbeda dengan hash dokumen' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;
  -- pending → pending/signed/failed; failed → failed/pending (kirim ulang); signed final. Kolom lain tetap.
  IF NOT ((OLD.status = 'pending') OR (OLD.status = 'failed' AND NEW.status IN ('failed', 'pending')))
     OR (to_jsonb(NEW) - mutable) IS DISTINCT FROM (to_jsonb(OLD) - mutable) THEN
    RAISE EXCEPTION 'SIGNATURE_IMMUTABLE: tanda tangan % sudah final', OLD.id USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $fn$;

ALTER TABLE "patient_identifiers" DROP CONSTRAINT patient_identifiers_verification_valid;
ALTER TABLE "patient_identifiers" ADD CONSTRAINT patient_identifiers_verification_valid
  CHECK (verification_status IN ('unverified', 'pending', 'verified', 'mismatch', 'not_found', 'error'));

-- AlterTable (outbox_messages: hak UPDATE aplikasi berlaku seluruh tabel, jadi kolom baru ikut bisa diisi).
ALTER TABLE "outbox_messages" ADD COLUMN "requeued_at" TIMESTAMPTZ(3);
