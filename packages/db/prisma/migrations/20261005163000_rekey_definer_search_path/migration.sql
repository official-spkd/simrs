-- Fungsi SECURITY DEFINER rotasi kunci (10.9b) dibuat dengan `SET search_path = public` tanpa pg_temp, sama seperti
-- yang diperbaiki migrasi 20261005150000: skema sementara sesi pemanggil dicari LEBIH DULU untuk tabel, sehingga
-- tabel sementara `tenants` bisa membuat job rotasi melewatkan tenant. pg_temp di akhir = dicari terakhir. Isi fungsi
-- tidak berubah. ADR-0008 (daftar fungsi SECURITY DEFINER).
ALTER FUNCTION app_rekey_patient_identifier(uuid, text, text, text, text) SET search_path = public, pg_temp;
ALTER FUNCTION app_rekey_patient_link(uuid, text, text) SET search_path = public, pg_temp;
ALTER FUNCTION app_rekey_patient_contact(uuid, text, text, text, text, text, text) SET search_path = public, pg_temp;
ALTER FUNCTION app_key_rotation_tenant_ids() SET search_path = public, pg_temp;
