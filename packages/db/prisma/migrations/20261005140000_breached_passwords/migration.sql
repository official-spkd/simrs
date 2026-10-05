-- Fase 1 · P02: daftar kata sandi bocor offline (docs/05 §1 "cek daftar bocor"; ADR-0011, pembaruan 5 Okt 2026).
-- Global di skema `ref` (sama untuk semua RS, tanpa data pasien) dan read-only bagi aplikasi: diisi operator lewat
-- `pnpm db:import-breached` (role migrator) dari daftar resmi, mis. Pwned Passwords. Yang disimpan hanya SHA-1
-- (format Have I Been Pwned), bukan kata sandi. Aplikasi mencari per rentang awalan 20 bit (gaya k-anonymity),
-- jadi kueri tidak pernah memuat hash utuh. Ditulis manual (tidak dimodelkan Prisma), seperti data rujukan lain.

CREATE TABLE ref.breached_passwords (
  sha1        bytea PRIMARY KEY,
  -- Berapa kali muncul di dataset sumber (bila formatnya memuat hitungan); NULL untuk daftar teks.
  occurrences bigint,
  CONSTRAINT breached_passwords_sha1_length CHECK (octet_length(sha1) = 20),
  CONSTRAINT breached_passwords_occurrences_positive CHECK (occurrences IS NULL OR occurrences > 0)
);

-- Riwayat impor (yang terbaru menggambarkan isi tabel): sumber, versi, jumlah entri.
CREATE TABLE ref.breached_password_imports (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source      text NOT NULL,
  version     text NOT NULL,
  entry_count integer NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT breached_password_imports_source_length CHECK (char_length(source) BETWEEN 1 AND 100),
  CONSTRAINT breached_password_imports_version_length CHECK (char_length(version) BETWEEN 1 AND 40),
  CONSTRAINT breached_password_imports_count CHECK (entry_count >= 0)
);

-- Aplikasi hanya membaca; tidak ada hak tulis (impor lewat role migrator).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'simrs_app') THEN
    GRANT SELECT ON ref.breached_passwords, ref.breached_password_imports TO simrs_app;
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ref.breached_passwords, ref.breached_password_imports FROM simrs_app;
  END IF;
END $$;
