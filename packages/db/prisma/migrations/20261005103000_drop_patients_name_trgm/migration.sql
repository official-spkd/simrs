-- Fase 1 · P05: indeks GIN trigram lama di patients.name_search dibuang. Di bawah FORCE RLS operator pg_trgm tidak
-- leakproof sehingga indeks ini tidak pernah dipakai; pencarian nama kini lewat search.patient_names +
-- app_search_patient_names (migrasi 20261005090000, ADR-0015). Deteksi duplikat memakai fungsi similarity() per
-- baris (tidak memakai indeks). Menghemat biaya tulis setiap INSERT/UPDATE pasien.
DROP INDEX IF EXISTS "patients_name_search_trgm";
