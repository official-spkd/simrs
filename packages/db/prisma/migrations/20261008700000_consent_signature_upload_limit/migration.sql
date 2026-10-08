-- ADR-0109 · Batas unggahan gambar tanda tangan per draf persetujuan (tablet). Setiap unggahan menyimpan satu dokumen
-- pasien; tanpa batas, satu draf terbuka bisa dipakai menimbun berkas. Penghitung naik di transaksi unggahan (baris draf
-- dikunci), dan batas ditegakkan juga di database. Ukuran per gambar tetap `CONSENT_SIGNATURE_MAX_BYTES` (middleware).
ALTER TABLE "consent_drafts" ADD COLUMN "signature_uploads" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "consent_drafts" ADD CONSTRAINT consent_drafts_signature_uploads_valid
  CHECK (signature_uploads BETWEEN 0 AND 5);

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'simrs_app') THEN
    GRANT UPDATE (signature_uploads) ON "consent_drafts" TO simrs_app;
  END IF;
END $do$;
