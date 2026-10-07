-- Fase 4 · 4.9 · S08 gerbang keselamatan bank darah + S07 satu diet aktif (ADR-0105). Melengkapi 4.0b:
-- - aturan ABO per komponen (sel darah merah / plasma / identik): 4.0b memakai aturan sel darah merah untuk semua
--   komponen, padahal plasma golongan O ke pasien A/B/AB inkompatibel;
-- - cek ganda dua petugas (sesi masing-masing) sebelum kantong keluar: `blood_issue_checks` + `blood_issues.issue_check_id`;
-- - transfusi di samping pasien: pindai gelang ↔ nomor kantong oleh pemasang, lalu verifikasi ulang oleh petugas kedua;
--   TTV transfusi append-only;
-- - golongan pasien di permintaan boleh diisi bank darah sampai crossmatch pertama (lalu terkunci).

-- AlterTable
ALTER TABLE "blood_components" ADD COLUMN     "abo_rule" TEXT NOT NULL DEFAULT 'sel_darah_merah';

-- AlterTable
ALTER TABLE "blood_issues" ADD COLUMN     "issue_check_id" UUID;

-- CreateTable
CREATE TABLE "blood_issue_checks" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "blood_request_id" UUID NOT NULL,
    "blood_unit_id" UUID NOT NULL,
    "checklist" JSONB NOT NULL,
    "emergency_reason" TEXT,
    "checked_by" UUID NOT NULL,
    "checked_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blood_issue_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfusions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "blood_issue_id" UUID NOT NULL,
    "encounter_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "start_scan_id" UUID NOT NULL,
    "start_bag_no" TEXT NOT NULL,
    "started_by" UUID NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verify_scan_id" UUID,
    "verify_bag_no" TEXT,
    "verified_by" UUID,
    "verified_at" TIMESTAMPTZ(3),
    "status" TEXT NOT NULL DEFAULT 'menunggu_verifikasi',
    "ended_at" TIMESTAMPTZ(3),
    "ended_by" UUID,
    "stop_reason" TEXT,

    CONSTRAINT "transfusions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfusion_vitals" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "transfusion_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "temp_c" DECIMAL(4,1) NOT NULL,
    "systolic" INTEGER NOT NULL,
    "diastolic" INTEGER NOT NULL,
    "pulse" INTEGER NOT NULL,
    "signs" TEXT[],
    "recorded_by" UUID NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transfusion_vitals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "blood_issue_checks_tenant_id_blood_request_id_idx" ON "blood_issue_checks"("tenant_id", "blood_request_id");

-- CreateIndex
CREATE UNIQUE INDEX "blood_issue_checks_tenant_id_id_key" ON "blood_issue_checks"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "transfusions_tenant_id_encounter_id_idx" ON "transfusions"("tenant_id", "encounter_id");

-- CreateIndex
CREATE UNIQUE INDEX "transfusions_tenant_id_id_key" ON "transfusions"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "transfusions_tenant_id_blood_issue_id_key" ON "transfusions"("tenant_id", "blood_issue_id");

-- CreateIndex
CREATE INDEX "transfusion_vitals_tenant_id_transfusion_id_recorded_at_idx" ON "transfusion_vitals"("tenant_id", "transfusion_id", "recorded_at");

-- CreateIndex
CREATE UNIQUE INDEX "transfusion_vitals_tenant_id_id_key" ON "transfusion_vitals"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "blood_issues_tenant_id_issue_check_id_key" ON "blood_issues"("tenant_id", "issue_check_id");

-- FK komposit selama migrasi (FORCE dipulihkan di bawah).
ALTER TABLE "blood_components" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "blood_requests" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "blood_units" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "blood_issues" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "encounters" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "patients" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "users" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "wristband_scans" NO FORCE ROW LEVEL SECURITY;

-- AddForeignKey
ALTER TABLE "blood_issues" ADD CONSTRAINT "blood_issues_tenant_id_issue_check_id_fkey" FOREIGN KEY ("tenant_id", "issue_check_id") REFERENCES "blood_issue_checks"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blood_issue_checks" ADD CONSTRAINT "blood_issue_checks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blood_issue_checks" ADD CONSTRAINT "blood_issue_checks_tenant_id_blood_request_id_fkey" FOREIGN KEY ("tenant_id", "blood_request_id") REFERENCES "blood_requests"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blood_issue_checks" ADD CONSTRAINT "blood_issue_checks_tenant_id_blood_unit_id_fkey" FOREIGN KEY ("tenant_id", "blood_unit_id") REFERENCES "blood_units"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blood_issue_checks" ADD CONSTRAINT "blood_issue_checks_tenant_id_checked_by_fkey" FOREIGN KEY ("tenant_id", "checked_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfusions" ADD CONSTRAINT "transfusions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfusions" ADD CONSTRAINT "transfusions_tenant_id_blood_issue_id_fkey" FOREIGN KEY ("tenant_id", "blood_issue_id") REFERENCES "blood_issues"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfusions" ADD CONSTRAINT "transfusions_tenant_id_encounter_id_fkey" FOREIGN KEY ("tenant_id", "encounter_id") REFERENCES "encounters"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfusions" ADD CONSTRAINT "transfusions_tenant_id_patient_id_fkey" FOREIGN KEY ("tenant_id", "patient_id") REFERENCES "patients"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfusions" ADD CONSTRAINT "transfusions_tenant_id_start_scan_id_fkey" FOREIGN KEY ("tenant_id", "start_scan_id") REFERENCES "wristband_scans"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfusions" ADD CONSTRAINT "transfusions_tenant_id_verify_scan_id_fkey" FOREIGN KEY ("tenant_id", "verify_scan_id") REFERENCES "wristband_scans"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfusions" ADD CONSTRAINT "transfusions_tenant_id_started_by_fkey" FOREIGN KEY ("tenant_id", "started_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfusions" ADD CONSTRAINT "transfusions_tenant_id_verified_by_fkey" FOREIGN KEY ("tenant_id", "verified_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfusions" ADD CONSTRAINT "transfusions_tenant_id_ended_by_fkey" FOREIGN KEY ("tenant_id", "ended_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfusion_vitals" ADD CONSTRAINT "transfusion_vitals_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfusion_vitals" ADD CONSTRAINT "transfusion_vitals_tenant_id_transfusion_id_fkey" FOREIGN KEY ("tenant_id", "transfusion_id") REFERENCES "transfusions"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfusion_vitals" ADD CONSTRAINT "transfusion_vitals_tenant_id_recorded_by_fkey" FOREIGN KEY ("tenant_id", "recorded_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "blood_components" FORCE ROW LEVEL SECURITY;
ALTER TABLE "blood_requests" FORCE ROW LEVEL SECURITY;
ALTER TABLE "blood_units" FORCE ROW LEVEL SECURITY;
ALTER TABLE "blood_issues" FORCE ROW LEVEL SECURITY;
ALTER TABLE "encounters" FORCE ROW LEVEL SECURITY;
ALTER TABLE "patients" FORCE ROW LEVEL SECURITY;
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;
ALTER TABLE "wristband_scans" FORCE ROW LEVEL SECURITY;

DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['blood_issue_checks', 'transfusions', 'transfusion_vitals'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) '
      || 'WITH CHECK (tenant_id = app_current_tenant())', t);
  END LOOP;
END $do$;

-- ---------------------------------------------------------------------
-- Nilai sah.
-- ---------------------------------------------------------------------
ALTER TABLE "blood_components" ADD CONSTRAINT blood_components_abo_rule_valid CHECK (
  abo_rule IN ('sel_darah_merah', 'plasma', 'identik'));
-- Lima butir cek ganda pertama semuanya dicentang (BLOOD_ISSUE_CHECK_ITEMS di @simrs/shared).
ALTER TABLE "blood_issue_checks" ADD CONSTRAINT blood_issue_checks_values_valid CHECK (
  checklist = '{"identitas": true, "nomor": true, "golongan": true, "kedaluwarsa": true, "kantong_utuh": true}'::jsonb
  AND (emergency_reason IS NULL OR char_length(btrim(emergency_reason)) BETWEEN 10 AND 500));
-- Kantong baru selalu lewat cek ganda pertama (baris lama 4.0b tidak divalidasi ulang).
ALTER TABLE "blood_issues" ADD CONSTRAINT blood_issues_double_check_required CHECK (issue_check_id IS NOT NULL) NOT VALID;
ALTER TABLE "transfusions" ADD CONSTRAINT transfusions_values_valid CHECK (
  status IN ('menunggu_verifikasi', 'berjalan', 'selesai', 'dihentikan')
  AND char_length(start_bag_no) BETWEEN 1 AND 40
  AND (verify_bag_no IS NULL OR char_length(verify_bag_no) BETWEEN 1 AND 40)
  AND (status = 'menunggu_verifikasi') = (verified_at IS NULL)
  AND (verified_at IS NULL) = (verified_by IS NULL)
  AND (verified_at IS NULL) = (verify_scan_id IS NULL)
  AND (verified_at IS NULL) = (verify_bag_no IS NULL)
  AND (verified_by IS NULL OR verified_by <> started_by)
  AND (status IN ('selesai', 'dihentikan')) = (ended_at IS NOT NULL)
  AND (ended_at IS NULL) = (ended_by IS NULL)
  AND (status = 'dihentikan') = (stop_reason IS NOT NULL)
  AND (stop_reason IS NULL OR char_length(btrim(stop_reason)) BETWEEN 10 AND 500));
ALTER TABLE "transfusion_vitals" ADD CONSTRAINT transfusion_vitals_values_valid CHECK (
  label IN ('awal', '15_menit', '1_jam', 'selesai', 'lain')
  AND temp_c BETWEEN 30 AND 45 AND systolic BETWEEN 30 AND 300 AND diastolic BETWEEN 10 AND 200
  AND pulse BETWEEN 20 AND 250 AND signs IS NOT NULL AND cardinality(signs) <= 10);

-- S07 · Satu order diet aktif per kunjungan (order baru menutup yang lama di transaksi yang sama).
CREATE UNIQUE INDEX diet_orders_one_active ON "diet_orders" (tenant_id, encounter_id) WHERE status = 'aktif';

-- ---------------------------------------------------------------------
-- Aturan ABO per komponen. Sel darah merah: antigen donor ⊆ antigen pasien (O donor universal). Plasma/trombosit:
-- antibodi donor tidak boleh menyerang sel pasien (AB donor universal; O hanya untuk pasien O). Darah lengkap:
-- golongan identik. Rh-negatif pasien hanya menerima Rh-negatif untuk semua komponen (konservatif).
-- ---------------------------------------------------------------------
ALTER TABLE "blood_components" NO FORCE ROW LEVEL SECURITY;
UPDATE "blood_components" SET abo_rule = 'plasma' WHERE code IN ('FFP', 'TC');
UPDATE "blood_components" SET abo_rule = 'identik' WHERE code = 'WB';
ALTER TABLE "blood_components" FORCE ROW LEVEL SECURITY;

CREATE FUNCTION app_blood_abo_compatible(patient text, donor text, rule text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT CASE rule
    WHEN 'plasma' THEN donor = 'AB' OR patient = 'O' OR patient = donor
    WHEN 'identik' THEN patient = donor
    ELSE donor = 'O' OR patient = 'AB' OR patient = donor
  END
$fn$;

-- Pengganti gerbang 4.0b: aturan ABO mengikuti komponen; kantong yang dicadangkan untuk permintaan lain tidak keluar;
-- jalur darurat tanpa crossmatch (keputusan no. 22) hanya untuk sel darah merah golongan O. Plasma/trombosit/darah
-- lengkap wajib golongan pasien diketahui.
CREATE OR REPLACE FUNCTION app_blood_issue_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  u record;
  rq record;
  rule text;
  matched boolean;
BEGIN
  SELECT * INTO u FROM blood_units WHERE tenant_id = NEW.tenant_id AND id = NEW.blood_unit_id FOR UPDATE;
  SELECT * INTO rq FROM blood_requests WHERE tenant_id = NEW.tenant_id AND id = NEW.blood_request_id;
  IF u.id IS NULL OR rq.id IS NULL OR rq.encounter_id <> NEW.encounter_id OR rq.patient_id <> NEW.patient_id
     OR u.component_id <> rq.component_id THEN
    RAISE EXCEPTION 'VALIDATION_FAILED: kantong/permintaan tidak cocok' USING ERRCODE = 'P0001';
  END IF;
  IF u.status NOT IN ('tersedia', 'dicadangkan') OR u.expires_at <= statement_timestamp() THEN
    RAISE EXCEPTION 'BATCH_EXPIRED: kantong kedaluwarsa atau tidak tersedia' USING ERRCODE = 'P0001';
  END IF;
  SELECT c.abo_rule INTO rule FROM blood_components c WHERE c.tenant_id = NEW.tenant_id AND c.id = u.component_id;
  IF rq.patient_abo IS NULL AND rule <> 'sel_darah_merah' THEN
    RAISE EXCEPTION 'BLOOD_INCOMPATIBLE: golongan pasien wajib diketahui untuk komponen ini' USING ERRCODE = 'P0001';
  END IF;
  IF (rq.patient_abo IS NOT NULL AND NOT app_blood_abo_compatible(rq.patient_abo, u.abo, rule))
     OR (rq.patient_rh = 'neg' AND u.rh <> 'neg') THEN
    RAISE EXCEPTION 'BLOOD_INCOMPATIBLE: golongan darah kantong tidak kompatibel' USING ERRCODE = 'P0001';
  END IF;
  matched := EXISTS (SELECT 1 FROM crossmatches x WHERE x.tenant_id = NEW.tenant_id
                       AND x.blood_request_id = NEW.blood_request_id AND x.blood_unit_id = NEW.blood_unit_id
                       AND x.result = 'cocok');
  IF NOT matched THEN
    IF u.status = 'dicadangkan' THEN
      RAISE EXCEPTION 'BLOOD_UNIT_UNAVAILABLE: kantong dicadangkan untuk permintaan lain' USING ERRCODE = 'P0001';
    END IF;
    IF NEW.emergency_reason IS NULL OR u.abo <> 'O' OR rule <> 'sel_darah_merah' THEN
      RAISE EXCEPTION 'CROSSMATCH_REQUIRED: crossmatch cocok wajib (darurat: golongan O beralasan)' USING ERRCODE = 'P0001';
    END IF;
    IF rq.patient_rh IS NULL AND u.rh <> 'neg' THEN
      RAISE EXCEPTION 'BLOOD_INCOMPATIBLE: darurat tanpa Rh pasien hanya O Rh-negatif' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END $fn$;

-- ---------------------------------------------------------------------
-- Cek ganda dua petugas sebelum kantong keluar (pola keputusan fase 4 no. 12: petugas kedua dari sesinya sendiri).
-- Cek pertama berumur ≤ 30 menit, kantong/permintaan/alasan darurat sama, dan pengeluar ≠ pemeriksa pertama.
-- ---------------------------------------------------------------------
CREATE FUNCTION app_blood_issue_double_check() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  c record;
BEGIN
  SELECT * INTO c FROM blood_issue_checks WHERE tenant_id = NEW.tenant_id AND id = NEW.issue_check_id;
  IF c.id IS NULL OR c.blood_request_id <> NEW.blood_request_id OR c.blood_unit_id <> NEW.blood_unit_id
     OR c.emergency_reason IS DISTINCT FROM NEW.emergency_reason
     OR c.checked_at < statement_timestamp() - interval '30 minutes' THEN
    RAISE EXCEPTION 'BLOOD_DOUBLE_CHECK_REQUIRED: cek ganda pertama tidak ada, tidak cocok, atau kedaluwarsa'
      USING ERRCODE = 'P0001';
  END IF;
  IF c.checked_by = NEW.issued_by THEN
    RAISE EXCEPTION 'BLOOD_SECOND_CHECKER_SAME: petugas kedua harus orang lain' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER blood_issues_double_check BEFORE INSERT ON "blood_issues"
  FOR EACH ROW EXECUTE FUNCTION app_blood_issue_double_check();

-- Golongan pasien di permintaan terkunci setelah crossmatch/cek ganda/pengeluaran pertama.
CREATE FUNCTION app_blood_request_group_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF (NEW.patient_abo, NEW.patient_rh) IS DISTINCT FROM (OLD.patient_abo, OLD.patient_rh)
     AND (EXISTS (SELECT 1 FROM crossmatches x WHERE x.tenant_id = NEW.tenant_id AND x.blood_request_id = NEW.id)
          OR EXISTS (SELECT 1 FROM blood_issue_checks c WHERE c.tenant_id = NEW.tenant_id AND c.blood_request_id = NEW.id)
          OR EXISTS (SELECT 1 FROM blood_issues i WHERE i.tenant_id = NEW.tenant_id AND i.blood_request_id = NEW.id)) THEN
    RAISE EXCEPTION 'BLOOD_GROUP_LOCKED: golongan pasien terkunci setelah crossmatch' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER blood_requests_group_guard BEFORE UPDATE ON "blood_requests"
  FOR EACH ROW EXECUTE FUNCTION app_blood_request_group_guard();

-- ---------------------------------------------------------------------
-- Transfusi di samping pasien: gelang ↔ kantong + petugas kedua. Pindaian gelang (tabel fase 3) harus cocok untuk
-- kunjungan ini, milik petugas yang sama, gelang belum dibatalkan, dan tidak lebih lama dari
-- `emar.scan_valid_minutes`; nomor kantong yang dipindai sama dengan kantong yang dikeluarkan. Transfusi berjalan
-- hanya setelah petugas KEDUA (bukan pemasang) memindai ulang gelang + kantong dari sesinya sendiri.
-- ---------------------------------------------------------------------
CREATE FUNCTION app_transfusion_check_scan(tenant uuid, scan_id uuid, enc uuid, actor uuid) RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE
  s record;
  valid_minutes integer;
BEGIN
  SELECT * INTO s FROM wristband_scans WHERE tenant_id = tenant AND id = scan_id;
  IF s.id IS NULL OR NOT s.matched OR s.encounter_id <> enc THEN
    RAISE EXCEPTION 'BLOOD_WRONG_PATIENT: gelang tidak cocok dengan pasien permintaan darah' USING ERRCODE = 'P0001';
  END IF;
  IF s.user_id <> actor THEN
    RAISE EXCEPTION 'WRISTBAND_SCAN_REQUIRED: pindaian gelang milik petugas lain' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM patient_wristbands w WHERE w.tenant_id = tenant AND w.id = s.wristband_id
                   AND w.voided_at IS NULL) THEN
    RAISE EXCEPTION 'WRISTBAND_SCAN_REQUIRED: gelang sudah dibatalkan; pindai gelang aktif' USING ERRCODE = 'P0001';
  END IF;
  SELECT coalesce((SELECT (value #>> '{}')::integer FROM tenant_settings
                   WHERE tenant_id = tenant AND key = 'emar.scan_valid_minutes'), 10)
    INTO valid_minutes;
  IF statement_timestamp() - s.scanned_at > make_interval(mins => valid_minutes) THEN
    RAISE EXCEPTION 'WRISTBAND_SCAN_REQUIRED: pindaian gelang kedaluwarsa; pindai ulang' USING ERRCODE = 'P0001';
  END IF;
END $fn$;

CREATE FUNCTION app_transfusion_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  i record;
  bag text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'APPEND_ONLY: transfusi tidak dihapus' USING ERRCODE = 'P0001';
  END IF;
  SELECT bi.encounter_id, bi.patient_id, u.bag_no INTO i
  FROM blood_issues bi JOIN blood_units u ON u.tenant_id = bi.tenant_id AND u.id = bi.blood_unit_id
  WHERE bi.tenant_id = NEW.tenant_id AND bi.id = NEW.blood_issue_id;
  IF i.bag_no IS NULL OR i.encounter_id <> NEW.encounter_id OR i.patient_id <> NEW.patient_id THEN
    RAISE EXCEPTION 'VALIDATION_FAILED: transfusi tidak cocok dengan pengeluaran kantong' USING ERRCODE = 'P0001';
  END IF;
  bag := upper(regexp_replace(i.bag_no, '\s', '', 'g'));
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'menunggu_verifikasi' OR NEW.verified_by IS NOT NULL OR NEW.ended_at IS NOT NULL THEN
      RAISE EXCEPTION 'TRANSFUSION_STATE: transfusi baru menunggu verifikasi petugas kedua' USING ERRCODE = 'P0001';
    END IF;
    PERFORM app_transfusion_check_scan(NEW.tenant_id, NEW.start_scan_id, NEW.encounter_id, NEW.started_by);
    IF upper(regexp_replace(NEW.start_bag_no, '\s', '', 'g')) <> bag THEN
      RAISE EXCEPTION 'BLOOD_WRONG_BAG: nomor kantong tidak cocok dengan kantong yang dikeluarkan' USING ERRCODE = 'P0001';
    END IF;
    NEW.started_at := statement_timestamp();
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.blood_issue_id, NEW.encounter_id, NEW.patient_id, NEW.start_scan_id, NEW.start_bag_no,
      NEW.started_by, NEW.started_at)
     IS DISTINCT FROM (OLD.id, OLD.blood_issue_id, OLD.encounter_id, OLD.patient_id, OLD.start_scan_id,
      OLD.start_bag_no, OLD.started_by, OLD.started_at) THEN
    RAISE EXCEPTION 'APPEND_ONLY: data pemasangan transfusi tidak bisa diubah' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.status = 'menunggu_verifikasi' AND NEW.status = 'berjalan' THEN
    IF NEW.verified_by IS NULL OR NEW.verified_by = OLD.started_by THEN
      RAISE EXCEPTION 'BLOOD_SECOND_CHECKER_SAME: verifikasi oleh petugas kedua, bukan pemasang' USING ERRCODE = 'P0001';
    END IF;
    PERFORM app_transfusion_check_scan(NEW.tenant_id, NEW.verify_scan_id, NEW.encounter_id, NEW.verified_by);
    IF upper(regexp_replace(coalesce(NEW.verify_bag_no, ''), '\s', '', 'g')) <> bag THEN
      RAISE EXCEPTION 'BLOOD_WRONG_BAG: nomor kantong tidak cocok dengan kantong yang dikeluarkan' USING ERRCODE = 'P0001';
    END IF;
    NEW.verified_at := statement_timestamp();
    RETURN NEW;
  END IF;
  IF OLD.status = 'berjalan' AND NEW.status IN ('selesai', 'dihentikan')
     AND (NEW.verified_by, NEW.verified_at, NEW.verify_scan_id, NEW.verify_bag_no)
         IS NOT DISTINCT FROM (OLD.verified_by, OLD.verified_at, OLD.verify_scan_id, OLD.verify_bag_no) THEN
    NEW.ended_at := statement_timestamp();
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'TRANSFUSION_STATE: perubahan status transfusi tidak sah' USING ERRCODE = 'P0001';
END $fn$;
CREATE TRIGGER transfusions_guard BEFORE INSERT OR UPDATE OR DELETE ON "transfusions"
  FOR EACH ROW EXECUTE FUNCTION app_transfusion_guard();

-- Append-only + waktu server untuk cek ganda pertama dan tanda vital transfusi.
CREATE TRIGGER blood_issue_checks_append_only BEFORE UPDATE OR DELETE ON "blood_issue_checks"
  FOR EACH ROW EXECUTE FUNCTION app_reject_mutation();
CREATE TRIGGER transfusion_vitals_append_only BEFORE UPDATE OR DELETE ON "transfusion_vitals"
  FOR EACH ROW EXECUTE FUNCTION app_reject_mutation();
CREATE TRIGGER blood_issue_checks_server_time BEFORE INSERT ON "blood_issue_checks"
  FOR EACH ROW EXECUTE FUNCTION app_support_server_time('checked_at');
CREATE TRIGGER transfusion_vitals_server_time BEFORE INSERT ON "transfusion_vitals"
  FOR EACH ROW EXECUTE FUNCTION app_support_server_time('recorded_at');

-- ---------------------------------------------------------------------
-- Hak akses role aplikasi: tanpa DELETE; cek ganda dan TTV append-only; transfusi hanya kolom verifikasi/penutupan;
-- golongan pasien di permintaan (dijaga trigger kunci golongan).
-- ---------------------------------------------------------------------
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'simrs_app') THEN
    REVOKE ALL ON "blood_issue_checks", "transfusions", "transfusion_vitals" FROM simrs_app;
    GRANT SELECT, INSERT ON "blood_issue_checks", "transfusions", "transfusion_vitals" TO simrs_app;
    GRANT UPDATE (verify_scan_id, verify_bag_no, verified_by, verified_at, status, ended_at, ended_by, stop_reason)
      ON "transfusions" TO simrs_app;
    GRANT UPDATE (patient_abo, patient_rh) ON "blood_requests" TO simrs_app;
  END IF;
END $do$;
