-- Fase 3 · potongan 3.1 · infrastruktur API klinis (manual, tanpa perubahan model Prisma).

-- EP 10c: temuan "akses pasien rahasia" ikut ringkasan harian audit (ADR-0072; versi ringkasan naik ke 2).
ALTER TABLE "audit_daily_summary_items" DROP CONSTRAINT audit_daily_summary_items_format;
ALTER TABLE "audit_daily_summary_items" ADD CONSTRAINT audit_daily_summary_items_format CHECK (
  kind IN ('login_failed', 'access_denied', 'night', 'volume', 'confidential') AND n > 0);

-- Pasien rahasia sedikit: indeks parsial untuk pencarian temuan.
CREATE INDEX patients_confidential ON "patients" ("tenant_id", "id") WHERE confidential;

-- Kanal SSE eskalasi EWS (ADR-0026): setiap tanda vital bertanda NEWS2 memberi tahu pelanggan (payload tenant + id);
-- ambang eskalasi RS (`ews.escalation_score`) diterapkan saat event dibaca.
CREATE TRIGGER observations_vitals_notify AFTER INSERT ON "observations"
  FOR EACH ROW WHEN (NEW.category = 'vital' AND NEW.ews_score IS NOT NULL)
  EXECUTE FUNCTION app_notify_row('clinical_vitals');
