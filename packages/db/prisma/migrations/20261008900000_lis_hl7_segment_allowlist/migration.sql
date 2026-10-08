-- =====================================================================
-- S01 · HL7 analyzer di `inbound_events`: daftar izin segmen (audit agen BUG, 4.1a)
-- Melengkapi `inbound_events_hl7_redacted` (hanya PID/NK1). Setiap segmen pesan `lis-hl7` wajib salah satu dari:
--   - segmen yang disimpan apa adanya: MSH, SFT, ORC, OBR, OBX, NTE, SPM, TQ1 (`HL7_STORED_SEGMENTS`);
--   - segmen lain dalam bentuk teredaksi tanpa isi `SEG|1` (mis. `PID|1`, `PV1|1`, `ZPI|1`).
-- Jadi PD1/PV1/GT1/IN1/MRG/segmen Z mentah (identitas pasien, penjamin, kunjungan) ditolak di basis data walau
-- aplikasi lupa meredaksi. Regex ARE Postgres: lookahead negatif (?!…) didukung; segmen dipisah \r (atau \n).
-- NOT VALID lalu VALIDATE hanya bila tidak ada baris lama yang melanggar (pesan yang tersimpan sebelum perbaikan
-- redaksi tidak diubah; constraint tetap menjaga setiap baris baru).
-- Pemeriksaan baris lama lintas tenant butuh RLS dilepas sementara (pola migrasi: NO FORCE … FORCE).
-- =====================================================================
ALTER TABLE "inbound_events" NO FORCE ROW LEVEL SECURITY;

ALTER TABLE "inbound_events" ADD CONSTRAINT inbound_events_hl7_segment_allowlist CHECK (
  source <> 'lis-hl7'
  OR raw_body !~ '(^|[\r\n])(?!(MSH|SFT|ORC|OBR|OBX|NTE|SPM|TQ1)[^\r\n])(?![A-Z0-9]{3}[^\r\n]1([\r\n]|$))'
) NOT VALID;

DO $do$
DECLARE
  bad bigint;
BEGIN
  SELECT count(*) INTO bad FROM inbound_events
   WHERE source = 'lis-hl7'
     AND raw_body ~ '(^|[\r\n])(?!(MSH|SFT|ORC|OBR|OBX|NTE|SPM|TQ1)[^\r\n])(?![A-Z0-9]{3}[^\r\n]1([\r\n]|$))';
  IF bad = 0 THEN
    ALTER TABLE "inbound_events" VALIDATE CONSTRAINT inbound_events_hl7_segment_allowlist;
  ELSE
    RAISE NOTICE 'inbound_events_hl7_segment_allowlist dibiarkan NOT VALID: % pesan lis-hl7 lama di luar daftar izin', bad;
  END IF;
END $do$;

ALTER TABLE "inbound_events" FORCE ROW LEVEL SECURITY;
