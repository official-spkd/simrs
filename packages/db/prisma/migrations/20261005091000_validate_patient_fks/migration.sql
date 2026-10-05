-- Fase 1 · P05 Validasi FK access_relationships / break_glass_grants → patients yang dipasang NOT VALID di
-- migrasi 20261004070000 (ADR-0015 §7, pembaruan 5 Okt 2026). Ditulis manual; schema.prisma tidak berubah.
--
-- Basis data lama (terutama database tes bersama) bisa berisi baris yang merujuk ID pasien acak, dibuat sebelum
-- tabel pasien ada. VALIDATE pada data seperti itu gagal dan menggagalkan migrasi. Karena itu validasi lewat
-- fungsi yang menghitung baris yatim dulu: nol → VALIDATE; ada → peringatan, FK tetap NOT VALID (baris baru tetap
-- diperiksa penuh), dan TIDAK ADA data yang dihapus. Fungsi bisa dijalankan ulang oleh operator setelah data
-- dibereskan (lihat ADR-0015).
--
-- Penting: VALIDATE di bawah FORCE RLS dengan app.tenant_id terset hanya memeriksa baris tenant itu, padahal
-- constraint lalu ditandai valid untuk semua baris (pemeriksaan awal FK ikut tersaring kebijakan; dibuktikan di
-- simrs_test_infra 5 Okt 2026). Tanpa app.tenant_id, VALIDATE gagal TENANT_REQUIRED. Maka fungsi melepas FORCE
-- sementara pada ketiga tabel (pemilik membaca semua tenant) dan memasangnya lagi sebelum selesai.
CREATE FUNCTION app_validate_patient_fks()
RETURNS TABLE (constraint_name text, orphan_rows bigint, validated boolean)
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  fk record;
BEGIN
  ALTER TABLE public.patients NO FORCE ROW LEVEL SECURITY;
  ALTER TABLE public.access_relationships NO FORCE ROW LEVEL SECURITY;
  ALTER TABLE public.break_glass_grants NO FORCE ROW LEVEL SECURITY;

  FOR fk IN
    SELECT v.tbl, v.con, c.convalidated AS ok
    FROM (VALUES ('access_relationships', 'access_relationships_tenant_id_patient_id_fkey'),
                 ('break_glass_grants', 'break_glass_grants_tenant_id_patient_id_fkey')) AS v (tbl, con)
    JOIN pg_constraint c ON c.conname = v.con AND c.conrelid = format('public.%I', v.tbl)::regclass
    ORDER BY v.con
  LOOP
    constraint_name := fk.con;
    validated := fk.ok;
    EXECUTE format(
      'SELECT count(*) FROM public.%I r WHERE NOT EXISTS '
      '(SELECT 1 FROM public.patients p WHERE p.tenant_id = r.tenant_id AND p.id = r.patient_id)', fk.tbl)
      INTO orphan_rows;
    IF NOT fk.ok AND orphan_rows = 0 THEN
      BEGIN
        EXECUTE format('ALTER TABLE public.%I VALIDATE CONSTRAINT %I', fk.tbl, fk.con);
        validated := true;
      EXCEPTION WHEN foreign_key_violation THEN
        RAISE WARNING 'FK % belum divalidasi: pemeriksaan menemukan baris yatim baru', fk.con;
      END;
    ELSIF NOT fk.ok THEN
      RAISE WARNING 'FK % belum divalidasi: % baris merujuk pasien yang tidak ada (data lama, tidak dihapus). Lihat ADR-0015.',
        fk.con, orphan_rows;
    END IF;
    RETURN NEXT;
  END LOOP;

  ALTER TABLE public.patients FORCE ROW LEVEL SECURITY;
  ALTER TABLE public.access_relationships FORCE ROW LEVEL SECURITY;
  ALTER TABLE public.break_glass_grants FORCE ROW LEVEL SECURITY;
END $$;
-- Hanya pemilik tabel (role migrator) atau superuser yang memanggilnya; role aplikasi tidak.
REVOKE ALL ON FUNCTION app_validate_patient_fks() FROM PUBLIC;

-- Jalankan sekarang. Tidak pernah menggagalkan migrasi karena data lama.
SELECT * FROM app_validate_patient_fks();
