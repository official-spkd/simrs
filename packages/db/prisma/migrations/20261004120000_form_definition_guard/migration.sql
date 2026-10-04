-- Fase 1 · P07: penjaga definisi formulir diperketat (ADR-0019).
-- Sebelumnya hanya kolom isi tertentu (schema, judul, hak tulis, kode, versi, kategori) yang dibekukan pada versi
-- terbit/arsip; catatan perubahan dan jejak pengajuan/terbit masih bisa diubah. Kini SEMUA kolom versi terbit beku
-- kecuali pengarsipan (status published -> archived + archived_at) dan jejak ubah (updated_at/updated_by).
-- Perbandingan lewat to_jsonb: kolom yang ditambahkan kelak otomatis ikut beku (gagal tertutup).

CREATE OR REPLACE FUNCTION app_form_definition_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  mutable CONSTANT text[] := ARRAY['status', 'archived_at', 'updated_at', 'updated_by'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'FORM_DEFINITION_IMMUTABLE: definisi formulir tidak dihapus' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.status IN ('published', 'archived') AND (
       (to_jsonb(NEW) - mutable) IS DISTINCT FROM (to_jsonb(OLD) - mutable)
       OR NOT (NEW.status = OLD.status OR (OLD.status = 'published' AND NEW.status = 'archived'))
       OR (OLD.status = 'archived' AND NEW.archived_at IS DISTINCT FROM OLD.archived_at)) THEN
    RAISE EXCEPTION 'FORM_DEFINITION_IMMUTABLE: versi % formulir % sudah terbit', OLD.version, OLD.code
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $fn$;
