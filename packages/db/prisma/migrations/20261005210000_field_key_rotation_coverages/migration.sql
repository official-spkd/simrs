-- Fase 2 · temuan peninjau atas potongan 5a: rotasi kunci kolom (ADR-0015 pembaruan 5 Okt 2026) mencakup no. anggota
-- penjamin non-BPJS (`coverages.member_no_enc`, tujuan `contact`). Tanpa ini nilainya tidak terbaca lagi setelah
-- kunci lama dipensiunkan.
--
-- Penjaminan TERKUNCI sejak SEP terbit (`app_coverage_guard`). Enkripsi ulang bukan perubahan isi, jadi penjaga diberi
-- satu pengecualian sempit: baris terkunci boleh berganti HANYA `member_no_enc`, HANYA ke versi kunci lain, dan HANYA
-- dari fungsi rotasi `app_rekey_coverage_member` (penanda transaksi `app.rekey` + pelaku = pemilik tabel, yaitu
-- pemilik fungsi SECURITY DEFINER). Role aplikasi yang menyalakan `app.rekey` sendiri tetap ditolak (bukan pemilik).

-- Format terenkripsi mengikuti cincin kunci (`v1.`, `v2.`, …), bukan hanya `v1.`.
ALTER TABLE "coverages" DROP CONSTRAINT coverages_member_valid;
ALTER TABLE "coverages" ADD CONSTRAINT coverages_member_valid CHECK (
  (member_no_enc IS NULL OR app_field_key_id(member_no_enc) IS NOT NULL)
  AND (guarantee_letter_no IS NULL OR char_length(guarantee_letter_no) BETWEEN 1 AND 60));

CREATE OR REPLACE FUNCTION app_coverage_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'COVERAGE_LOCKED: penjaminan tidak dihapus' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.locked_at IS NOT NULL THEN
    IF current_setting('app.rekey', true) = 'on'
       AND current_user = (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid = TG_RELID)
       AND (to_jsonb(NEW) - 'member_no_enc') = (to_jsonb(OLD) - 'member_no_enc')
       AND OLD.member_no_enc IS NOT NULL
       AND app_field_key_id(NEW.member_no_enc) IS NOT NULL
       AND app_field_key_id(NEW.member_no_enc) IS DISTINCT FROM app_field_key_id(OLD.member_no_enc) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'COVERAGE_LOCKED: penjaminan terkunci sejak SEP terbit' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $fn$;

-- Compare-and-swap seperti `app_rekey_patient_contact`; tunduk RLS (FORCE berlaku bagi pemilik fungsi). Versi kunci
-- wajib berganti, juga untuk penjaminan yang belum terkunci (fungsi ini bukan jalan pintas mengubah no. anggota).
CREATE FUNCTION app_rekey_coverage_member(p_id uuid, p_old text, p_new text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  n integer;
BEGIN
  IF app_field_key_id(p_new) IS NULL THEN
    RAISE EXCEPTION 'REKEY_FORMAT: format nilai baru tidak valid' USING ERRCODE = 'P0001';
  END IF;
  IF app_field_key_id(p_new) IS NOT DISTINCT FROM app_field_key_id(p_old) THEN
    RAISE EXCEPTION 'REKEY_SAME_KEY: coverages.member_no_enc hanya boleh ditulis ulang dengan versi kunci lain'
      USING ERRCODE = 'P0001';
  END IF;
  PERFORM set_config('app.rekey', 'on', true);
  UPDATE coverages SET member_no_enc = p_new WHERE id = p_id AND member_no_enc = p_old;
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM set_config('app.rekey', '', true);
  RETURN n = 1;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.rekey', '', true);
  RAISE;
END $fn$;
REVOKE ALL ON FUNCTION app_rekey_coverage_member(uuid, text, text) FROM PUBLIC;

ALTER TABLE "field_key_rotations" DROP CONSTRAINT field_key_rotations_target_valid;
ALTER TABLE "field_key_rotations" ADD CONSTRAINT field_key_rotations_target_valid CHECK (target IN (
  'users', 'mfa_factors', 'login_challenges', 'patients', 'patient_identifiers', 'patient_links',
  'patient_contacts', 'coverages'));

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'simrs_app') THEN
    GRANT EXECUTE ON FUNCTION app_rekey_coverage_member(uuid, text, text) TO simrs_app;
  END IF;
END $do$;
