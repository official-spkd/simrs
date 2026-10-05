-- Fungsi SECURITY DEFINER lama memakai `SET search_path = public` tanpa pg_temp. Bila pg_temp tidak disebut,
-- PostgreSQL mencari skema sementara LEBIH DULU untuk tabel: sesi simrs_app (punya hak TEMP) bisa membuat tabel
-- sementara `tenants` dan membuat fungsi ini, yang berjalan sebagai pemilik, mengembalikan ID tenant pilihannya
-- (dibuktikan 5 Okt 2026 di DB tes). pg_temp di akhir = dicari terakhir. Isi fungsi tidak berubah. ADR-0008.
ALTER FUNCTION app_active_tenant_ids() SET search_path = public, pg_temp;
ALTER FUNCTION app_resolve_tenant_by_code(text) SET search_path = public, pg_temp;
ALTER FUNCTION app_resolve_tenant_by_host(text) SET search_path = public, pg_temp;
