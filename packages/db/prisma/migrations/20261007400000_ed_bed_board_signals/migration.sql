-- W3 · Sinyal papan IGD dan papan bed (ADR-0104). Sebelumnya kanal `ed_board` hanya dipicu `ed_status_events` dan
-- `bed_board` hanya `bed_status_events`: pasien IGD baru, triase, permintaan bed (dibuat/dialokasikan/batal), dan
-- kunjungan IGD yang selesai tidak sampai ke layar yang sedang terbuka. Setiap perubahan itu kini mencatat satu baris
-- `board_signals` (id baru per perubahan, jadi SSE tidak membuangnya sebagai duplikat seperti bila id baris sumber
-- dipakai ulang saat UPDATE), dan baris itu yang di-`pg_notify` (`{ tenant_id, id }`, ADR-0026). Muatan tanpa nama.

-- CreateTable
CREATE TABLE "board_signals" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "board" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "source_id" UUID NOT NULL,
    "encounter_id" UUID NOT NULL,
    "unit_id" UUID,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "board_signals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "board_signals_tenant_id_created_at_idx" ON "board_signals"("tenant_id", "created_at");

-- AddForeignKey
ALTER TABLE "board_signals" ADD CONSTRAINT "board_signals_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================
-- Nilai, RLS, hak akses: hanya ditulis trigger (role aplikasi INSERT lewat trigger di transaksinya), dibaca kanal SSE.
-- =====================================================================
ALTER TABLE "board_signals" ADD CONSTRAINT board_signals_values_valid CHECK (
  board IN ('ed', 'bed')
  AND source IN ('encounter', 'triage', 'bed_request')
  AND char_length(status) BETWEEN 1 AND 30);

ALTER TABLE "board_signals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "board_signals" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "board_signals"
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'simrs_app') THEN
    GRANT SELECT, INSERT ON "board_signals" TO simrs_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON "board_signals" FROM simrs_app;
  END IF;
END $do$;

-- =====================================================================
-- Pencatat sinyal (SECURITY INVOKER: tunduk RLS pemanggil, tenant sama dengan baris sumber).
-- =====================================================================

-- Kunjungan IGD masuk (registrasi) atau berubah status (triase pertama, selesai, batal).
CREATE FUNCTION app_board_signal_encounter() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  INSERT INTO board_signals (id, tenant_id, board, source, source_id, encounter_id, unit_id, status, created_at)
  VALUES (gen_random_uuid(), NEW.tenant_id, 'ed', 'encounter', NEW.id, NEW.id, NEW.unit_id, NEW.status,
          clock_timestamp());
  RETURN NULL;
END $fn$;
CREATE TRIGGER encounters_board_signal_insert AFTER INSERT ON "encounters"
  FOR EACH ROW WHEN (NEW.class = 'EMER') EXECUTE FUNCTION app_board_signal_encounter();
CREATE TRIGGER encounters_board_signal_update AFTER UPDATE OF status ON "encounters"
  FOR EACH ROW WHEN (NEW.class = 'EMER' AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION app_board_signal_encounter();

-- Asesmen triase (versi baru atau koreksi).
CREATE FUNCTION app_board_signal_triage() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  v_unit uuid;
BEGIN
  SELECT unit_id INTO v_unit FROM encounters WHERE tenant_id = NEW.tenant_id AND id = NEW.encounter_id;
  INSERT INTO board_signals (id, tenant_id, board, source, source_id, encounter_id, unit_id, status, created_at)
  VALUES (gen_random_uuid(), NEW.tenant_id, 'ed', 'triage', NEW.id, NEW.encounter_id, v_unit, NEW.status,
          clock_timestamp());
  RETURN NULL;
END $fn$;
CREATE TRIGGER triage_assessments_board_signal AFTER INSERT ON "triage_assessments"
  FOR EACH ROW EXECUTE FUNCTION app_board_signal_triage();

-- Permintaan bed: papan bed selalu (unit tujuan = unit bed yang dialokasikan, atau unit diminta, null = mana pun);
-- papan IGD bila kunjungan asalnya IGD.
CREATE FUNCTION app_board_signal_bed_request() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  v_class text;
  v_unit uuid;
  v_target uuid := NEW.unit_id;
BEGIN
  SELECT class, unit_id INTO v_class, v_unit FROM encounters WHERE tenant_id = NEW.tenant_id AND id = NEW.encounter_id;
  IF NEW.allocated_location_id IS NOT NULL THEN
    SELECT unit_id INTO v_target FROM locations WHERE tenant_id = NEW.tenant_id AND id = NEW.allocated_location_id;
  END IF;
  INSERT INTO board_signals (id, tenant_id, board, source, source_id, encounter_id, unit_id, status, created_at)
  VALUES (gen_random_uuid(), NEW.tenant_id, 'bed', 'bed_request', NEW.id, NEW.encounter_id, v_target, NEW.status,
          clock_timestamp());
  IF v_class = 'EMER' THEN
    INSERT INTO board_signals (id, tenant_id, board, source, source_id, encounter_id, unit_id, status, created_at)
    VALUES (gen_random_uuid(), NEW.tenant_id, 'ed', 'bed_request', NEW.id, NEW.encounter_id, v_unit, NEW.status,
            clock_timestamp());
  END IF;
  RETURN NULL;
END $fn$;
CREATE TRIGGER bed_requests_board_signal_insert AFTER INSERT ON "bed_requests"
  FOR EACH ROW EXECUTE FUNCTION app_board_signal_bed_request();
CREATE TRIGGER bed_requests_board_signal_update AFTER UPDATE ON "bed_requests"
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status
                     OR OLD.allocated_location_id IS DISTINCT FROM NEW.allocated_location_id)
  EXECUTE FUNCTION app_board_signal_bed_request();

-- Kanal papan sesuai kolom `board`; payload hanya tenant_id + id sinyal.
CREATE FUNCTION app_board_signal_notify() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM pg_notify(CASE NEW.board WHEN 'ed' THEN 'ed_board' ELSE 'bed_board' END,
                    json_build_object('tenant_id', NEW.tenant_id, 'id', NEW.id)::text);
  RETURN NULL;
END $fn$;
CREATE TRIGGER board_signals_notify AFTER INSERT ON "board_signals"
  FOR EACH ROW EXECUTE FUNCTION app_board_signal_notify();
