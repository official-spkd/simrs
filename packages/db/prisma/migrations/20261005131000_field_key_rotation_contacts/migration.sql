-- Fase 10 · 10.9b (utang P05): rotasi kunci kolom mencakup kontak keluarga/penanggung jawab pasien
-- (`patient_contacts`, fase 2 potongan 0b; ADR-0015 pembaruan 5 Okt 2026).
--
-- `patient_contacts` append-only (koreksi = baris baru). Enkripsi ulang bukan koreksi isi: nilai yang sama ditulis
-- ulang dengan kunci lain. Penjaga baru menggantikan `app_reject_mutation` pada tabel ini:
-- - DELETE selalu ditolak (juga pemilik tabel);
-- - UPDATE hanya dari fungsi sempit `app_rekey_patient_contact` (penanda transaksi `app.rekey`), hanya kolom
--   terenkripsi, dan hanya bila versi kunci tiap kolom yang berubah memang berganti. Kolom lain tetap final.

ALTER TABLE "patient_contacts" DROP CONSTRAINT patient_contacts_encrypted;
ALTER TABLE "patient_contacts" ADD CONSTRAINT patient_contacts_encrypted CHECK (
  app_field_key_id(name_enc) IS NOT NULL
  AND (phone_enc IS NULL OR app_field_key_id(phone_enc) IS NOT NULL)
  AND (address_enc IS NULL OR app_field_key_id(address_enc) IS NOT NULL));

CREATE FUNCTION app_patient_contact_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  enc CONSTANT text[] := ARRAY['name_enc', 'phone_enc', 'address_enc'];
  col text;
BEGIN
  IF TG_OP = 'DELETE' OR current_setting('app.rekey', true) IS DISTINCT FROM 'on'
     OR (to_jsonb(NEW) - enc) IS DISTINCT FROM (to_jsonb(OLD) - enc) THEN
    RAISE EXCEPTION 'APPEND_ONLY: % pada % tidak diizinkan', TG_OP, TG_TABLE_NAME USING ERRCODE = 'P0001';
  END IF;
  FOREACH col IN ARRAY enc LOOP
    IF (to_jsonb(NEW) ->> col) IS DISTINCT FROM (to_jsonb(OLD) ->> col)
       AND (app_field_key_id(to_jsonb(NEW) ->> col) IS NOT DISTINCT FROM app_field_key_id(to_jsonb(OLD) ->> col)
            OR (to_jsonb(NEW) ->> col) IS NULL OR (to_jsonb(OLD) ->> col) IS NULL) THEN
      RAISE EXCEPTION 'REKEY_SAME_KEY: %.% hanya boleh ditulis ulang dengan versi kunci lain', TG_TABLE_NAME, col
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  RETURN NEW;
END $fn$;

DROP TRIGGER patient_contacts_append_only ON "patient_contacts";
CREATE TRIGGER patient_contacts_append_only BEFORE UPDATE OR DELETE ON "patient_contacts"
  FOR EACH ROW EXECUTE FUNCTION app_patient_contact_guard();

-- Compare-and-swap seperti `app_rekey_patient_identifier`; tunduk RLS (FORCE berlaku bagi pemilik fungsi).
CREATE FUNCTION app_rekey_patient_contact(
  p_id uuid,
  p_old_name text, p_old_phone text, p_old_address text,
  p_new_name text, p_new_phone text, p_new_address text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  n integer;
BEGIN
  PERFORM set_config('app.rekey', 'on', true);
  UPDATE patient_contacts SET name_enc = p_new_name, phone_enc = p_new_phone, address_enc = p_new_address
  WHERE id = p_id AND name_enc = p_old_name
    AND phone_enc IS NOT DISTINCT FROM p_old_phone AND address_enc IS NOT DISTINCT FROM p_old_address;
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM set_config('app.rekey', '', true);
  RETURN n = 1;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.rekey', '', true);
  RAISE;
END $fn$;
REVOKE ALL ON FUNCTION app_rekey_patient_contact(uuid, text, text, text, text, text, text) FROM PUBLIC;

ALTER TABLE "field_key_rotations" DROP CONSTRAINT field_key_rotations_target_valid;
ALTER TABLE "field_key_rotations" ADD CONSTRAINT field_key_rotations_target_valid CHECK (target IN (
  'users', 'mfa_factors', 'login_challenges', 'patients', 'patient_identifiers', 'patient_links',
  'patient_contacts'));

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'simrs_app') THEN
    GRANT EXECUTE ON FUNCTION app_rekey_patient_contact(uuid, text, text, text, text, text, text) TO simrs_app;
  END IF;
END $do$;
