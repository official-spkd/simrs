-- Fase 1 · P05 Pencarian nama pasien memakai indeks trigram di bawah RLS (ADR-0015, pembaruan 5 Okt 2026).
-- Ditulis manual; tidak ada perubahan schema.prisma (skema `search` di luar jangkauan Prisma, seperti `ref`).
--
-- Masalah: operator pg_trgm (`%`, `<%`) tidak leakproof. Di bawah FORCE RLS, PostgreSQL tidak boleh menjalankan
-- operator itu sebelum kebijakan tenant, sehingga indeks GIN `patients_name_search_trgm` tidak dipakai untuk
-- kondisi nama dan pencarian memindai seluruh pasien satu RS.
--
-- Solusi (pola ADR-0008 `app_active_tenant_ids()`):
-- 1. `search.patient_names`: salinan (tenant_id, patient_id, name_search) dengan indeks GIN trigram. RLS ENABLE
--    tanpa FORCE: pemiliknya (simrs_migrator, lewat fungsi SECURITY DEFINER) membaca tanpa kebijakan sehingga
--    indeks terpakai; simrs_app tidak punya hak apa pun atas skema/tabel ini.
-- 2. Trigger di `patients` menyalin name_search saat INSERT/UPDATE (satu sumber kebenaran tetap `patients`).
-- 3. `app_search_patient_names(teks)`: tenant SELALU dari `app_current_tenant()` (bukan parameter), hanya
--    mengembalikan (patient_id, score). API lalu memuat pasien lewat `patients` dengan RLS seperti biasa.

CREATE SCHEMA IF NOT EXISTS search;
REVOKE ALL ON SCHEMA search FROM PUBLIC;

CREATE TABLE search.patient_names (
  patient_id  uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL,
  name_search text NOT NULL,
  -- DEFERRABLE (bawaan tetap IMMEDIATE): tes rencana kueri bisa mengisi data sintetis dalam transaksi yang dibatalkan.
  CONSTRAINT patient_names_patient_fkey FOREIGN KEY (tenant_id, patient_id)
    REFERENCES public.patients (tenant_id, id) ON DELETE CASCADE ON UPDATE CASCADE
    DEFERRABLE INITIALLY IMMEDIATE
);
-- Tanpa FORCE (registri baca-pemilik, ADR-0008). Kebijakan tetap dipasang sebagai pengaman berlapis.
ALTER TABLE search.patient_names ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON search.patient_names
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

-- Sinkronisasi dari patients. SECURITY DEFINER: simrs_app tidak bisa menulis tabel indeks secara langsung;
-- yang disalin hanya baris pasien yang baru saja lolos RLS (WITH CHECK) milik transaksi itu sendiri.
CREATE FUNCTION app_sync_patient_name() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  INSERT INTO search.patient_names (patient_id, tenant_id, name_search)
  VALUES (NEW.id, NEW.tenant_id, NEW.name_search)
  ON CONFLICT (patient_id) DO UPDATE SET name_search = EXCLUDED.name_search;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION app_sync_patient_name() FROM PUBLIC;

CREATE TRIGGER patients_sync_name_search
  AFTER INSERT OR UPDATE OF name_search ON "patients"
  FOR EACH ROW EXECUTE FUNCTION app_sync_patient_name();

-- Isi awal dari pasien yang sudah ada (NO FORCE sementara agar pemilik membaca semua tenant).
ALTER TABLE "patients" NO FORCE ROW LEVEL SECURITY;
INSERT INTO search.patient_names (patient_id, tenant_id, name_search)
SELECT id, tenant_id, name_search FROM "patients"
ON CONFLICT (patient_id) DO NOTHING;
ALTER TABLE "patients" FORCE ROW LEVEL SECURITY;

-- Indeks dibuat setelah isi awal (pembangunan massal lebih cepat). (tenant_id lewat btree_gin, name_search lewat
-- pg_trgm), sama dengan patients_name_search_trgm. fastupdate = off: dengan daftar tunda GIN, setiap pemindaian
-- indeks ikut membaca seluruh daftar tunda sehingga perencana memilih memindai tabel penuh (diukur 5 Okt 2026,
-- PostgreSQL 16: 100 ribu nama satu RS dipindai penuh, ±200 ms per pencarian; tanpa daftar tunda indeks dipakai,
-- < 1 ms untuk nama spesifik). Pendaftaran pasien jarang dibanding pencarian, jadi sisip langsung ke indeks murah.
CREATE INDEX patient_names_trgm ON search.patient_names USING gin (tenant_id, name_search gin_trgm_ops)
  WITH (fastupdate = off);

-- Pencarian nama. Kriteria dan skor sama dengan kueri lama di API: kemiripan keseluruhan (`%`, ambang 0,3),
-- kemiripan kata (`<%`, ambang 0,6; mis. sebagian nama atau salah ketik), atau memuat teks (LIKE; karakter
-- wildcard di-escape). Ambang dipatok di fungsi (bawaan pg_trgm) agar SET di sesi tidak mengubah hasil.
-- - Tenant dibaca dari app_current_tenant() (TENANT_REQUIRED bila kosong), tidak pernah dari parameter.
-- - SQL dinamis dengan nilai lewat USING (bukan disambung ke teks): direncanakan dengan nilai sebenarnya,
--   sehingga perkiraan baris dan pilihan indeks akurat per pencarian.
-- - ROWS 100 (perkiraan, bawaan 1000): agar API menggabungkan hasil ke `patients` lewat indeks PK per kandidat,
--   bukan hash join yang memindai seluruh pasien RS.
-- - Semua objek ditulis lengkap dengan skemanya; search_path dipatok.
CREATE FUNCTION app_search_patient_names(p_query text)
RETURNS TABLE (patient_id uuid, score real)
LANGUAGE plpgsql STABLE SECURITY DEFINER ROWS 100
SET search_path = pg_catalog, pg_temp
SET pg_trgm.similarity_threshold = 0.3
SET pg_trgm.word_similarity_threshold = 0.6
AS $fn$
DECLARE
  v_tenant uuid := public.app_current_tenant();
  v_like text := '%' || replace(replace(replace(p_query, '\', '\\'), '%', '\%'), '_', '\_') || '%';
BEGIN
  RETURN QUERY EXECUTE
    'SELECT n.patient_id,
            greatest(public.similarity(n.name_search, $2), public.word_similarity($2, n.name_search))
     FROM search.patient_names n
     WHERE n.tenant_id = $1
       AND (n.name_search OPERATOR(public.%) $2
            OR $2 OPERATOR(public.<%) n.name_search
            OR n.name_search LIKE $3)'
    USING v_tenant, p_query, v_like;
END $fn$;
REVOKE ALL ON FUNCTION app_search_patient_names(text) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'simrs_app') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA search FROM simrs_app;
    GRANT EXECUTE ON FUNCTION app_search_patient_names(text) TO simrs_app;
  END IF;
END $$;
