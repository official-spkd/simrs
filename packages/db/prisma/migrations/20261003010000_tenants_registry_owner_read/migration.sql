-- ADR-0008 (revisi): app_active_tenant_ids() berjalan sebagai pemilik tabel (simrs_migrator).
-- FORCE ROW LEVEL SECURITY juga berlaku bagi pemilik, sehingga fungsi registri ikut terkena kebijakan
-- tenant_isolation dan gagal (TENANT_REQUIRED). Tabel `tenants` adalah registri (tanpa PHI): pemilik boleh
-- membacanya tanpa konteks. simrs_app tetap tunduk RLS karena ENABLE ROW LEVEL SECURITY tetap aktif.
-- Tabel domain lain TETAP FORCE.
ALTER TABLE "tenants" NO FORCE ROW LEVEL SECURITY;
