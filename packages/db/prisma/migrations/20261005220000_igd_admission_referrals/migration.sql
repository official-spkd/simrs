-- Fase 2 potongan 7 · F03 IGD + admisi rawat inap, F06 SPRI + rencana kontrol, F07 rujukan keluar/internal.
-- 1. `encounters`: cara datang + ciri-ciri pasien tanpa identitas (IGD), rencana masuk + kunjungan asal + SPRI dasar
--    (admisi `planned`); satu kunjungan IGD aktif dan satu admisi aktif per pasien; satu admisi per SPRI.
-- 2. `referrals`: tanggal rencana, unit rawat inap tujuan (SPRI), isi rujukan keluar (jenis pelayanan, jenis rujukan,
--    poli BPJS tujuan, catatan/alasan), status kirim BPJS (`sync_*`, pola SEP 5a), dan pembatalan berjejak. Rujukan
--    yang dibatalkan beku (kecuali status kirim hapus BPJS); nomor boleh kosong bila batal sebelum BPJS memberi nomor.
-- Tanpa tabel baru dan tanpa fungsi SECURITY DEFINER. Validasi FK baru ke/dari tabel ber-FORCE RLS tidak punya konteks
-- tenant, jadi FORCE dimatikan sementara pada tabel yang terlibat (satu transaksi, dikembalikan di akhir berkas).
ALTER TABLE "encounters" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "referrals" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "units" NO FORCE ROW LEVEL SECURITY;

-- =====================================================================
-- 1. Kunjungan
-- =====================================================================
ALTER TABLE "encounters" ADD COLUMN "arrival_mode" TEXT,
ADD COLUMN "identification_note" TEXT,
ADD COLUMN "planned_at" TIMESTAMPTZ(3),
ADD COLUMN "source_encounter_id" UUID,
ADD COLUMN "referral_id" UUID;

ALTER TABLE "encounters" ADD CONSTRAINT "encounters_tenant_id_source_encounter_id_fkey" FOREIGN KEY ("tenant_id", "source_encounter_id") REFERENCES "encounters"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_tenant_id_referral_id_fkey" FOREIGN KEY ("tenant_id", "referral_id") REFERENCES "referrals"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- IGD: cara datang wajib, ciri-ciri hanya untuk IGD. Admisi: rencana masuk wajib. Kunjungan asal bukan dirinya.
-- NOT VALID: baris lama (hanya data uji) tidak divalidasi ulang; semua baris baru/diubah tetap diperiksa.
ALTER TABLE "encounters" ADD CONSTRAINT encounters_class_fields CHECK (
  (arrival_mode IS NULL OR (class = 'EMER'
     AND arrival_mode IN ('datang_sendiri', 'ambulans', 'rujukan', 'diantar_polisi', 'lainnya')))
  AND (class <> 'EMER' OR arrival_mode IS NOT NULL)
  AND (identification_note IS NULL OR (class = 'EMER' AND char_length(identification_note) BETWEEN 3 AND 300))
  AND (planned_at IS NULL OR class = 'IMP')
  AND (class <> 'IMP' OR planned_at IS NOT NULL)
  AND (referral_id IS NULL OR class = 'IMP')
  AND source_encounter_id IS DISTINCT FROM id) NOT VALID;

CREATE UNIQUE INDEX encounters_one_active_emergency ON "encounters" ("tenant_id", "patient_id")
  WHERE class = 'EMER' AND status IN ('planned', 'arrived', 'in_progress');
CREATE UNIQUE INDEX encounters_one_active_admission ON "encounters" ("tenant_id", "patient_id")
  WHERE class = 'IMP' AND status IN ('planned', 'arrived', 'in_progress');
CREATE UNIQUE INDEX encounters_one_per_referral ON "encounters" ("tenant_id", "referral_id")
  WHERE referral_id IS NOT NULL AND status <> 'cancelled';
CREATE INDEX encounters_tenant_id_source_encounter_id_idx ON "encounters" ("tenant_id", "source_encounter_id");

-- Kelas, pasien, nomor, dan asal kunjungan tidak berubah (juga bagi pemilik tabel).
DROP TRIGGER encounters_immutable ON "encounters";
CREATE TRIGGER encounters_immutable BEFORE UPDATE ON "encounters"
  FOR EACH ROW EXECUTE FUNCTION app_immutable_columns('number', 'patient_id', 'class', 'created_at', 'arrival_mode',
                                                      'source_encounter_id', 'referral_id');

-- =====================================================================
-- 2. Rujukan, SPRI, surat kontrol
-- =====================================================================
ALTER TABLE "referrals" ADD COLUMN "planned_date" DATE,
ADD COLUMN "target_unit_id" UUID,
ADD COLUMN "service_type" TEXT,
ADD COLUMN "referral_type" TEXT,
ADD COLUMN "bpjs_poli_code" TEXT,
ADD COLUMN "note" TEXT,
ADD COLUMN "sync_status" TEXT NOT NULL DEFAULT 'not_required',
ADD COLUMN "synced_at" TIMESTAMPTZ(3),
ADD COLUMN "sync_error_code" TEXT,
ADD COLUMN "sync_seq" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "cancelled_at" TIMESTAMPTZ(3),
ADD COLUMN "cancelled_by" UUID,
ADD COLUMN "cancel_reason" TEXT;

ALTER TABLE "referrals" ADD CONSTRAINT "referrals_tenant_id_target_unit_id_fkey" FOREIGN KEY ("tenant_id", "target_unit_id") REFERENCES "units"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Nomor kosong hanya selama menunggu BPJS, atau bila dibatalkan sebelum BPJS memberi nomor.
ALTER TABLE "referrals" DROP CONSTRAINT referrals_valid;
ALTER TABLE "referrals" ADD CONSTRAINT referrals_valid CHECK (
  kind IN ('rujukan-fktp', 'rujukan-rs', 'surat-kontrol', 'rujukan-keluar', 'rujukan-internal', 'spri')
  AND status IN ('pending', 'active', 'used', 'expired', 'cancelled')
  AND (number IS NOT NULL OR status IN ('pending', 'cancelled'))
  AND (number IS NULL OR char_length(number) BETWEEN 3 AND 40)
  AND (valid_until IS NULL OR valid_until >= issued_on)
  AND (visit_no IS NULL OR visit_no >= 1));

ALTER TABLE "referrals" ADD CONSTRAINT referrals_detail_valid CHECK (
  (planned_date IS NULL OR planned_date >= issued_on)
  AND (target_unit_id IS NULL OR kind = 'spri')
  AND (service_type IS NULL OR (kind = 'rujukan-keluar' AND service_type IN ('rawat_jalan', 'rawat_inap')))
  AND (referral_type IS NULL OR (kind = 'rujukan-keluar' AND referral_type IN ('penuh', 'partial', 'rujuk_balik')))
  AND (bpjs_poli_code IS NULL OR bpjs_poli_code ~ '^[A-Z]{3}$')
  AND (note IS NULL OR char_length(note) BETWEEN 1 AND 500)
  AND (status = 'cancelled') = (cancelled_at IS NOT NULL)
  AND (cancelled_at IS NULL OR char_length(cancel_reason) BETWEEN 5 AND 300)) NOT VALID;

ALTER TABLE "referrals" ADD CONSTRAINT referrals_sync_valid CHECK (
  sync_status IN ('not_required', 'pending', 'sent', 'rejected', 'dead')
  AND (sync_status <> 'sent' OR synced_at IS NOT NULL)
  AND (sync_error_code IS NULL OR char_length(sync_error_code) BETWEEN 3 AND 60)
  AND sync_seq >= 1);

-- Penjaga: jenis, pasien, dan nomor tetap; rujukan batal beku seluruhnya kecuali status kirim (hapus di BPJS dicatat
-- sesudahnya).
CREATE OR REPLACE FUNCTION app_referral_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  trail_cols CONSTANT text[] := ARRAY['updated_at', 'updated_by', 'sync_status', 'synced_at', 'sync_error_code',
                                      'sync_seq'];
BEGIN
  IF NEW.kind IS DISTINCT FROM OLD.kind OR NEW.patient_id IS DISTINCT FROM OLD.patient_id
     OR (OLD.number IS NOT NULL AND NEW.number IS DISTINCT FROM OLD.number) THEN
    RAISE EXCEPTION 'REFERRAL_IMMUTABLE: jenis, pasien, dan nomor rujukan tidak bisa diubah' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.status = 'cancelled' AND (to_jsonb(NEW) - trail_cols) IS DISTINCT FROM (to_jsonb(OLD) - trail_cols) THEN
    RAISE EXCEPTION 'REFERRAL_IMMUTABLE: rujukan yang dibatalkan tidak bisa diubah' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $fn$;

CREATE INDEX referrals_tenant_id_encounter_id_idx ON "referrals" ("tenant_id", "encounter_id");

-- =====================================================================
-- Hak akses aplikasi: kolom isi baru hanya disisipkan; yang boleh berubah hanya status kirim dan pembatalan.
-- =====================================================================
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'simrs_app') THEN
    GRANT UPDATE (sync_status, synced_at, sync_error_code, sync_seq, cancelled_at, cancelled_by, cancel_reason)
      ON "referrals" TO simrs_app;
  END IF;
END $do$;

-- Kembalikan FORCE RLS (lihat catatan di awal berkas).
ALTER TABLE "encounters" FORCE ROW LEVEL SECURITY;
ALTER TABLE "referrals" FORCE ROW LEVEL SECURITY;
ALTER TABLE "units" FORCE ROW LEVEL SECURITY;
