# ADR-0037 · Gerbang keselamatan penunjang ditegakkan database

Tanggal: 7 Oktober 2026 · Status: diterima (rencana fase 4 keputusan no. 7, 8, 13, 14, 15, 22); diterapkan pada 4.0b
(migrasi `20261008100000_support_services`, tes `packages/db/test/support-services.test.ts`), API dan layar menyusul
4.2–4.9.

## Konteks

CLAUDE.md §4.9: gerbang keselamatan (nilai kritis, checklist bedah, darah) tidak boleh bisa dilewati diam-diam.
Pemeriksaan hanya di API bisa terlewat oleh bug atau jalur baru; fase 3 sudah menegakkan entri berversi dan eMAR di
database (ADR-0028, ADR-0077).

## Keputusan

1. **Entri berversi** ADR-0028 untuk `lab_results`, `imaging_reports`, `pa_reports`, `operative_reports` (rantai versi,
   view `_current`, append-only, waktu server). Riwayat status dan peristiwa penunjang append-only dengan waktu server.
2. **Nilai kritis** (`critical_results`): dibuat berstatus `terbuka` dengan waktu server; hanya laporan ber-read-back
   (`critical_result_reports`, penerima staf atau nama + peran) yang menutupnya (`CRITICAL_READBACK_REQUIRED`); satu
   laporan per nilai kritis; durasi lapor dan `within_limit` dihitung server dari batas pengaturan (bawaan 30 menit);
   eskalasi satu per level. Trigger laporan `app_critical_report_before` dan `app_critical_report_close` SECURITY DEFINER
   (`SET search_path = public, pg_temp`, kueri dibatasi `tenant_id = NEW.tenant_id`) karena perlu `FOR UPDATE`/UPDATE
   status yang tidak diberikan ke `simrs_app`.
3. **Validasi lab:** klinis hanya setelah teknis pada putaran yang sama (`VALIDATION_ORDER`); nilai kritis yang belum
   dilaporkan memblokir validasi tanpa override (`CRITICAL_OPEN`). QC Westgard (1-3s/2-2s ditolak) memblokir kecuali
   override beralasan (API 4.2).
4. **Radiologi:** dosis CT wajib (CHECK); tanpa PACS/DICOM MWL di fase 4, accession siap untuk itu.
5. **Kamar operasi:** jadwal tanpa tumpang tindih per kamar (`EXCLUDE USING gist`, `btree_gist`); daftar tilik WHO
   berversi per RS dengan urutan sign in → time out → sign out dan kelengkapan dijaga trigger (`CHECKLIST_ORDER`,
   `CHECKLIST_INCOMPLETE`), butir persetujuan diisi sistem; peristiwa berurutan induksi → insisi → tutup → keluar;
   insisi terkunci sampai time out kecuali override beralasan ≥ 15 karakter (pengaturan RS; hanya pemegang izin
   `surgery.override`, ditinjau mutu, diperiksa API); sign out butuh insisi tercatat + hitung akhir cocok atau
   ditindaklanjuti (`COUNT_MISMATCH`).
6. **Darah:** pengeluaran kantong dijaga trigger: kantong/permintaan cocok, tidak kedaluwarsa, ABO/Rh kompatibel
   (`BLOOD_INCOMPATIBLE`), crossmatch cocok wajib; darurat tanpa crossmatch hanya golongan O beralasan, O Rh-negatif bila
   Rh pasien belum diketahui (`CROSSMATCH_REQUIRED`). Kantong ABO-inkompatibel tidak pernah keluar.

## Konsekuensi

- Kode `RAISE` database dipetakan ke `SUPPORT_ERRORS` (`@simrs/shared`) oleh modul API, seperti `CLINICAL_ERRORS`.
- Override yang sah selalu meninggalkan alasan di baris yang sama (tidak ada jalur diam-diam).
- Tiga fungsi SECURITY DEFINER baru (stok + dua nilai kritis) masuk daftar tinjauan keamanan migrasi.
