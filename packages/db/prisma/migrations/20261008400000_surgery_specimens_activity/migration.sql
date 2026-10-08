-- Fase 4 §4.7b (ADR-0106) · Spesimen operasi untuk PA (S06 → S02) dan aliran aktivitas papan OK.
-- 1. `surgery_specimens`: spesimen terstruktur dari laporan operasi terkini (append-only). Event
--    `surgery.specimen_sent` (diterbitkan API) menjadi pemicu order PA potongan 4.8.
-- 2. Kanal `support_surgery_activity` (ADR-0026, `app_notify_row`): setiap baris baru di tabel kasus operasi (status,
--    butir tilik, konfirmasi fase, peristiwa, hitung, tindak lanjut, BHP, laporan, spesimen, formulir anestesi)
--    memberi tahu layar OK yang terbuka. Semua tabel ini append-only, jadi id baris = id perubahan. Kanal 4.1a
--    `support_surgery_board` (riwayat status) tidak diubah.

-- FK komposit ke tabel ber-FORCE RLS: FORCE dilepas sementara (dipulihkan setelah FK dibuat).
ALTER TABLE "surgery_cases" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "operative_reports" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "users" NO FORCE ROW LEVEL SECURITY;

-- CreateTable
CREATE TABLE "surgery_specimens" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "surgery_case_id" UUID NOT NULL,
    "operative_report_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "site" TEXT NOT NULL,
    "examination" TEXT NOT NULL,
    "containers" INTEGER NOT NULL,
    "fixative" TEXT NOT NULL,
    "clinical_note" TEXT NOT NULL,
    "cito" BOOLEAN NOT NULL DEFAULT false,
    "sent_by" UUID NOT NULL,
    "sent_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "surgery_specimens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "surgery_specimens_tenant_id_operative_report_id_idx" ON "surgery_specimens"("tenant_id", "operative_report_id");

-- CreateIndex
CREATE UNIQUE INDEX "surgery_specimens_tenant_id_id_key" ON "surgery_specimens"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "surgery_specimens_tenant_id_surgery_case_id_seq_key" ON "surgery_specimens"("tenant_id", "surgery_case_id", "seq");

-- AddForeignKey
ALTER TABLE "surgery_specimens" ADD CONSTRAINT "surgery_specimens_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surgery_specimens" ADD CONSTRAINT "surgery_specimens_tenant_id_surgery_case_id_fkey" FOREIGN KEY ("tenant_id", "surgery_case_id") REFERENCES "surgery_cases"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surgery_specimens" ADD CONSTRAINT "surgery_specimens_tenant_id_operative_report_id_fkey" FOREIGN KEY ("tenant_id", "operative_report_id") REFERENCES "operative_reports"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surgery_specimens" ADD CONSTRAINT "surgery_specimens_tenant_id_sent_by_fkey" FOREIGN KEY ("tenant_id", "sent_by") REFERENCES "users"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "surgery_cases" FORCE ROW LEVEL SECURITY;
ALTER TABLE "operative_reports" FORCE ROW LEVEL SECURITY;
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;

-- =====================================================================
-- Nilai (token = `packages/shared/src/schemas/surgery-specimen.ts`), RLS, hak akses, append-only, waktu server
-- =====================================================================
ALTER TABLE "surgery_specimens" ADD CONSTRAINT surgery_specimens_values_valid CHECK (
  seq >= 1
  AND char_length(btrim(site)) BETWEEN 2 AND 200
  AND examination IN ('histopatologi', 'potong_beku', 'sitologi', 'imunohistokimia')
  AND containers BETWEEN 1 AND 20
  AND fixative IN ('formalin_10', 'segar', 'alkohol_95', 'lainnya')
  AND (examination <> 'potong_beku' OR fixative = 'segar')
  AND char_length(btrim(clinical_note)) BETWEEN 5 AND 1000);

ALTER TABLE "surgery_specimens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "surgery_specimens" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "surgery_specimens"
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'simrs_app') THEN
    REVOKE ALL ON "surgery_specimens" FROM simrs_app;
    GRANT SELECT, INSERT ON "surgery_specimens" TO simrs_app;
  END IF;
END $do$;

CREATE TRIGGER surgery_specimens_append_only BEFORE UPDATE OR DELETE ON "surgery_specimens"
  FOR EACH ROW EXECUTE FUNCTION app_reject_mutation();
CREATE TRIGGER surgery_specimens_server_time BEFORE INSERT ON "surgery_specimens"
  FOR EACH ROW EXECUTE FUNCTION app_support_server_time('sent_at');

-- Spesimen hanya dari laporan operasi final kasus yang sama (bukan adendum). SECURITY INVOKER: tunduk RLS pemanggil.
CREATE FUNCTION app_surgery_specimen_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM operative_reports r
    WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.operative_report_id
      AND r.surgery_case_id = NEW.surgery_case_id AND r.status = 'final' AND r.addendum_of IS NULL
  ) THEN
    RAISE EXCEPTION 'SPECIMEN_REPORT_INVALID: spesimen harus menunjuk laporan operasi final kasus yang sama'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER surgery_specimens_guard BEFORE INSERT ON "surgery_specimens"
  FOR EACH ROW EXECUTE FUNCTION app_surgery_specimen_guard();

-- =====================================================================
-- Aliran aktivitas papan OK (payload hanya tenant_id + id baris)
-- =====================================================================
DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'surgery_case_status_history', 'surgical_safety_checks', 'surgical_safety_confirmations', 'surgery_events',
    'surgical_counts', 'surgery_count_discrepancies', 'surgery_supply_usages', 'operative_reports',
    'surgery_specimens'] LOOP
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT ON %I FOR EACH ROW EXECUTE FUNCTION app_notify_row(%L)',
      t || '_activity_notify', t, 'support_surgery_activity');
  END LOOP;
END $do$;

-- Formulir anestesi (P07) kunjungan: asesmen pra-anestesi dan catatan anestesi.
CREATE TRIGGER form_responses_surgery_activity_notify AFTER INSERT ON "form_responses"
  FOR EACH ROW WHEN (NEW.encounter_id IS NOT NULL AND NEW.form_code IN ('asesmen_pra_anestesi', 'catatan_anestesi'))
  EXECUTE FUNCTION app_notify_row('support_surgery_activity');
