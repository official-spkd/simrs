-- W3 · Sinyal papan IGD dan papan bed (ADR-0104). Sebelumnya kanal `ed_board` hanya dipicu `ed_status_events` dan
-- `bed_board` hanya `bed_status_events`: pasien IGD baru, triase, permintaan bed, dan kunjungan IGD yang selesai tidak
-- sampai ke layar yang sedang terbuka. Muatan tetap `{ tenant_id, id }` (`app_notify_row`, ADR-0026); kanal API
-- memetakan id ke event tanpa nama/diagnosis (`ed.changed`, `bed.request`).

-- Kunjungan IGD masuk (registrasi) atau berubah status (triase pertama, selesai, batal).
CREATE TRIGGER encounters_ed_board_notify AFTER INSERT OR UPDATE OF status ON "encounters"
  FOR EACH ROW WHEN (NEW.class = 'EMER') EXECUTE FUNCTION app_notify_row('ed_board');

-- Asesmen triase (versi baru atau koreksi).
CREATE TRIGGER triage_assessments_ed_board_notify AFTER INSERT ON "triage_assessments"
  FOR EACH ROW EXECUTE FUNCTION app_notify_row('ed_board');

-- Permintaan bed: dibuat, dialokasikan, selesai, atau batal. Tampil di papan IGD (status permintaan) dan papan bed.
CREATE TRIGGER bed_requests_ed_board_notify AFTER INSERT OR UPDATE ON "bed_requests"
  FOR EACH ROW EXECUTE FUNCTION app_notify_row('ed_board');
CREATE TRIGGER bed_requests_bed_board_notify AFTER INSERT OR UPDATE ON "bed_requests"
  FOR EACH ROW EXECUTE FUNCTION app_notify_row('bed_board');
