# ADR-0035 · Ingest hasil analyzer laboratorium

Tanggal: 7 Oktober 2026 · Status: diterima (rencana fase 4 keputusan no. 4, 5, 20); diterapkan sebagian pada 4.0a
(parser + kontrak), 4.0b (skema), 4.1b (mock analyzer). Endpoint ingest dan pemrosesan worker menyusul 4.1a/4.2.

## Konteks

Analyzer lab mengirim hasil dalam HL7 v2. Pesan memuat identitas pasien (PID/NK1) yang tidak boleh tersimpan di jalur
integrasi, dan hasil mesin tidak boleh langsung menjadi rekam medis tanpa verifikasi manusia.

## Keputusan

1. **Transport:** HL7 v2.5 `ORU^R01` lewat HTTP ke endpoint perangkat ber-HMAC (prinsipal perangkat ADR-0027, izin
   `lab.analyzer.ingest`), disimpan di `inbound_events` lalu diproses async (pola webhook masuk CLAUDE.md §4.6).
   MLLP/ASTM dan gateway edge menunggu I06.
2. **Parser murni** `packages/shared/src/integrations/lis/hl7.ts`: hanya MSH, PID, NK1, OBR, OBX, NTE; batas 256 KB.
   Segmen **PID dan NK1 diredaksi sebelum disimpan** (`redactHl7`). Pencocokan pasien **hanya lewat barcode spesimen**
   (OBR-3, cadangan OBR-2), tidak pernah lewat nama/RM dari mesin. Tanda tangan perangkat di
   `integrations/lis/signature.ts` (entri Node).
3. **Hasil analyzer selalu awal.** `lab_results.source = 'analyzer'` wajib merujuk `inbound_event_id`; tidak ada
   autoverifikasi. Validasi dua tahap oleh manusia (`lab_validations`: teknis lalu klinis, dijaga trigger).
4. **Mock** `apps/mock` meniru analyzer (ORU^R01 ber-HMAC, skenario, panel kendali) untuk lokal dan E2E (4.1b).
5. **Organisme mikrobiologi** memakai daftar lokal; pemetaan SNOMED setelah P06 punya SNOMED.

## Konsekuensi

- PHI dari mesin tidak pernah masuk `inbound_events`; jejak integrasi aman diekspor.
- Spesimen tanpa barcode yang cocok tidak menghasilkan hasil; pesannya tetap tercatat untuk ditinjau.
- Analyzer yang hanya bisa MLLP butuh gateway edge (I06) sebelum dipakai.
