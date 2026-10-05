-- Fase 10 · 10.9b (utang P05): rotasi kunci enkripsi kolom v2 + job enkripsi ulang bertahap
-- (ADR-0015, pembaruan 5 Okt 2026).
--
-- 1. Kolom terenkripsi menerima ciphertext berawalan ID kunci `v1`…`v999` (dulu hanya `v1.`), blind index menerima
--    bentuk berversi: 64 hex (kunci v1, format lama) atau `<ID>:<64 hex>` (kunci lain).
-- 2. Fungsi SECURITY DEFINER sempit untuk menulis ulang nilai identifier pasien dan snapshot penggabungan yang tidak
--    bisa diubah role aplikasi (hak kolom tetap dicabut): hanya ganti versi kunci, compare-and-swap, tunduk RLS.
-- 3. Tabel status `field_key_rotations` (kursor + hitungan per tenant × tabel) untuk job yang bisa dilanjutkan.
-- 4. PIN masuk cepat mencatat ID kunci lada (`pin_key_id`); alasan cabut baru `key_rotated`.

-- =====================================================================
-- 1. Format berversi
-- =====================================================================

-- ID kunci dari ciphertext tersimpan (`v2.…` → `v2`), NULL bila bukan format enkripsi kolom.
CREATE FUNCTION app_field_key_id(p_value text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT substring(p_value FROM '^(v[1-9][0-9]{0,2})\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+$');
$$;

-- ID kunci dari blind index tersimpan: 64 hex = `v1` (format lama), `vN:<64 hex>` = `vN` (N ≥ 2); NULL bila bukan
-- bentuk baku (termasuk `v1:…`, yang tidak pernah ditulis agar satu nilai punya satu bentuk).
CREATE FUNCTION app_blind_index_key_id(p_value text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN p_value ~ '^[0-9a-f]{64}$' THEN 'v1'
    WHEN p_value ~ '^v([2-9]|[1-9][0-9]{1,2}):[0-9a-f]{64}$' THEN split_part(p_value, ':', 1)
  END;
$$;

ALTER TABLE "patients" DROP CONSTRAINT patients_encrypted_columns;
ALTER TABLE "patients" ADD CONSTRAINT patients_encrypted_columns CHECK (
  (address_enc IS NULL OR app_field_key_id(address_enc) IS NOT NULL)
  AND (phone_enc IS NULL OR app_field_key_id(phone_enc) IS NOT NULL)
  AND (phone_hash IS NULL OR app_blind_index_key_id(phone_hash) IS NOT NULL)
  AND ((phone_enc IS NULL) = (phone_hash IS NULL)));

ALTER TABLE "patient_identifiers" DROP CONSTRAINT patient_identifiers_encrypted;
ALTER TABLE "patient_identifiers" ADD CONSTRAINT patient_identifiers_encrypted
  CHECK (app_field_key_id(value_enc) IS NOT NULL AND app_blind_index_key_id(value_hash) IS NOT NULL);

ALTER TABLE "users" DROP CONSTRAINT users_phone_enc_format;
ALTER TABLE "users" ADD CONSTRAINT users_phone_enc_format
  CHECK (phone_enc IS NULL OR app_field_key_id(phone_enc) IS NOT NULL);

ALTER TABLE "patient_links" DROP CONSTRAINT patient_links_snapshot_encrypted;
ALTER TABLE "patient_links" ADD CONSTRAINT patient_links_snapshot_encrypted
  CHECK (survivor_snapshot_enc IS NULL OR app_field_key_id(survivor_snapshot_enc) IS NOT NULL);

-- =====================================================================
-- 2. Tulis ulang nilai permanen hanya untuk ganti versi kunci
-- =====================================================================
-- Pemilik fungsi = pemilik tabel; FORCE RLS tetap berlaku sehingga hanya baris tenant `app.tenant_id` yang bisa
-- disentuh. Compare-and-swap (nilai lama harus persis sama) membuat job aman berjalan bersamaan dengan aplikasi
-- dan idempoten. Nilai yang sama versinya tidak bisa ditimpa: fungsi ini bukan jalan pintas mengubah identitas.

CREATE FUNCTION app_rekey_patient_identifier(
  p_id uuid, p_old_enc text, p_old_hash text, p_new_enc text, p_new_hash text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  n integer;
BEGIN
  IF app_field_key_id(p_new_enc) IS NULL OR app_blind_index_key_id(p_new_hash) IS NULL THEN
    RAISE EXCEPTION 'REKEY_FORMAT: format nilai baru tidak valid' USING ERRCODE = 'P0001';
  END IF;
  IF (p_new_enc IS DISTINCT FROM p_old_enc
        AND app_field_key_id(p_new_enc) IS NOT DISTINCT FROM app_field_key_id(p_old_enc))
     OR (p_new_hash IS DISTINCT FROM p_old_hash
        AND app_blind_index_key_id(p_new_hash) IS NOT DISTINCT FROM app_blind_index_key_id(p_old_hash))
     OR (p_new_enc IS NOT DISTINCT FROM p_old_enc AND p_new_hash IS NOT DISTINCT FROM p_old_hash) THEN
    RAISE EXCEPTION 'REKEY_SAME_KEY: nilai hanya boleh ditulis ulang dengan versi kunci lain' USING ERRCODE = 'P0001';
  END IF;
  UPDATE patient_identifiers SET value_enc = p_new_enc, value_hash = p_new_hash
  WHERE id = p_id AND value_enc = p_old_enc AND value_hash = p_old_hash;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n = 1;
END $fn$;

CREATE FUNCTION app_rekey_patient_link(p_id uuid, p_old_enc text, p_new_enc text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  n integer;
BEGIN
  IF app_field_key_id(p_new_enc) IS NULL THEN
    RAISE EXCEPTION 'REKEY_FORMAT: format nilai baru tidak valid' USING ERRCODE = 'P0001';
  END IF;
  -- Snapshot memuat ciphertext/hash bersarang; ditulis ulang setiap kali salah satu cincin berganti kunci aktif,
  -- jadi versi kunci luar boleh sama (isi bersarang yang berubah), asal ciphertext-nya berbeda.
  IF p_new_enc = p_old_enc THEN
    RAISE EXCEPTION 'REKEY_SAME_KEY: snapshot tidak berubah' USING ERRCODE = 'P0001';
  END IF;
  UPDATE patient_links SET survivor_snapshot_enc = p_new_enc
  WHERE id = p_id AND survivor_snapshot_enc = p_old_enc;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n = 1;
END $fn$;

-- Semua tenant (juga yang nonaktif): data RS yang dinonaktifkan tetap harus terbaca setelah kunci lama
-- dipensiunkan (retensi rekam medis). Hanya ID, pola ADR-0008; semua kerja data tetap lewat RLS.
CREATE FUNCTION app_key_rotation_tenant_ids() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM tenants ORDER BY id;
$$;

REVOKE ALL ON FUNCTION app_rekey_patient_identifier(uuid, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_rekey_patient_link(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_key_rotation_tenant_ids() FROM PUBLIC;

-- =====================================================================
-- 3. Status job enkripsi ulang (per tenant × tabel)
-- =====================================================================
CREATE TABLE "field_key_rotations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "target" TEXT NOT NULL,
    "enc_key_id" TEXT NOT NULL,
    "hash_key_id" TEXT NOT NULL,
    "cursor_id" UUID,
    "scanned" INTEGER NOT NULL DEFAULT 0,
    "rewritten" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "remaining" INTEGER,
    "last_error" TEXT,
    "last_failed_id" UUID,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),

    CONSTRAINT "field_key_rotations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "field_key_rotations_tenant_id_target_key" ON "field_key_rotations"("tenant_id", "target");

ALTER TABLE "field_key_rotations" ADD CONSTRAINT "field_key_rotations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "field_key_rotations" ADD CONSTRAINT field_key_rotations_target_valid CHECK (target IN (
  'users', 'mfa_factors', 'login_challenges', 'patients', 'patient_identifiers', 'patient_links'));
ALTER TABLE "field_key_rotations" ADD CONSTRAINT field_key_rotations_key_ids
  CHECK (enc_key_id ~ '^v[1-9][0-9]{0,2}$' AND hash_key_id ~ '^v[1-9][0-9]{0,2}$');
ALTER TABLE "field_key_rotations" ADD CONSTRAINT field_key_rotations_counts
  CHECK (scanned >= 0 AND rewritten >= 0 AND failed >= 0 AND (remaining IS NULL OR remaining >= 0));
-- Kode galat saja (mis. FIELD_KEY_UNKNOWN:v0), tidak pernah data atau pesan bebas.
ALTER TABLE "field_key_rotations" ADD CONSTRAINT field_key_rotations_last_error
  CHECK (last_error IS NULL OR last_error ~ '^[A-Z_]{3,40}(:v[1-9][0-9]{0,2})?$');

ALTER TABLE "field_key_rotations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "field_key_rotations" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "field_key_rotations"
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

-- =====================================================================
-- 4. PIN: ID kunci lada tercatat per perangkat
-- =====================================================================
-- Baris lama dilada dengan FIELD_HASH_KEY (= v1). DEFAULT hanya untuk mengisi baris lama tanpa UPDATE (trigger
-- penjaga menolak perubahan isi), lalu dibuang: aplikasi wajib mengisi ID kunci aktif secara eksplisit.
ALTER TABLE "registered_devices" ADD COLUMN "pin_key_id" TEXT DEFAULT 'v1';
ALTER TABLE "registered_devices" ALTER COLUMN "pin_key_id" DROP DEFAULT;
ALTER TABLE "registered_devices" ADD CONSTRAINT registered_devices_pin_key_id
  CHECK (pin_key_id IS NULL OR pin_key_id ~ '^v[1-9][0-9]{0,2}$');
ALTER TABLE "registered_devices" DROP CONSTRAINT registered_devices_staff_pin;
ALTER TABLE "registered_devices" ADD CONSTRAINT registered_devices_staff_pin CHECK (
  kind <> 'staff_pin' OR (
    user_id IS NOT NULL AND assignment_id IS NOT NULL AND pin_hash IS NOT NULL AND pin_key_id IS NOT NULL
    AND expires_at <= created_at + interval '30 days'));
ALTER TABLE "registered_devices" DROP CONSTRAINT registered_devices_revoked_consistent;
ALTER TABLE "registered_devices" ADD CONSTRAINT registered_devices_revoked_consistent CHECK (
  (revoked_at IS NULL) = (revoked_reason IS NULL)
  AND (revoked_by IS NULL OR revoked_at IS NOT NULL)
  AND (revoked_reason IS NULL OR revoked_reason IN ('user_removed', 'admin_revoked', 'too_many_attempts',
    'password_changed', 'password_reset', 'mfa_reset', 'user_disabled', 'assignment_ended', 'key_rotated')));

-- =====================================================================
-- Hak akses
-- =====================================================================
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'simrs_app') THEN
    GRANT SELECT, INSERT, UPDATE ON "field_key_rotations" TO simrs_app;
    REVOKE DELETE, TRUNCATE ON "field_key_rotations" FROM simrs_app;
    GRANT EXECUTE ON FUNCTION app_field_key_id(text) TO simrs_app;
    GRANT EXECUTE ON FUNCTION app_blind_index_key_id(text) TO simrs_app;
    GRANT EXECUTE ON FUNCTION app_rekey_patient_identifier(uuid, text, text, text, text) TO simrs_app;
    GRANT EXECUTE ON FUNCTION app_rekey_patient_link(uuid, text, text) TO simrs_app;
    GRANT EXECUTE ON FUNCTION app_key_rotation_tenant_ids() TO simrs_app;
    -- pin_key_id tidak bisa diubah (trigger penjaga + tanpa hak kolom UPDATE).
    REVOKE UPDATE (pin_key_id) ON "registered_devices" FROM simrs_app;
  END IF;
END $do$;
