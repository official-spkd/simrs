# ADR-0034 · Worklist penunjang dan ABAC lingkup unit penunjang

Tanggal: 7 Oktober 2026 · Status: diterima (rencana fase 4 keputusan no. 2, 3, 6, 18, 19, 23); diterapkan sebagian pada
4.0a (izin + kontrak) dan 4.0b (skema), API menyusul potongan 4.1a–4.9. Ditulis agen DOC dari keputusan rencana fase 4
dan hasil A5 (`docs/handoff/fase-4-0ab.md`).

## Konteks

Fase 3 sudah menulis order (CPOE, `order_groups` + `service_requests` + `medication_requests`). Unit penunjang (lab,
radiologi, farmasi, OK, gizi, bank darah) perlu daftar kerja dan akses ke data pasien yang dilayaninya, tanpa menjadi
tim perawatan pasien. ABAC fase 3 (ADR-0031) membuka pasien lewat relasi atau lokasi pasien kini, yang tidak cocok
untuk analis lab atau apoteker yang tidak pernah berada di bangsal pasien.

## Keputusan

1. **Worklist = kueri atas order fase 3.** Entitas kerja penunjang (`lab_orders`, `imaging_studies`,
   `pharmacy_prescriptions`, `surgery_cases`, `diet_orders`, `blood_requests`) dibuat saat unit **menerima** order,
   dengan FK komposit ke order sumber (`service_request_id`, `order_group_id`) dan kunci idempotensi. Order tidak
   disalin lewat event.
2. **ABAC penunjang lingkup `unit`.** Petugas penunjang membuka pasien bila ada order aktif yang ditujukan ke unit
   penugasannya, selama order aktif + 7 hari setelah selesai. Data yang tampil minimal: banner + data klinis relevan
   (eGFR, BB, alergi). Tidak menambah baris `access_relationships`.
3. **Izin fase 4** (4.0a, `packages/shared/src/authz.ts`): sumber `lab.*`, `radiology.*`, `pharmacy.*`, `stock.*`,
   `surgery.*`, `nutrition.*`, `blood_bank.*`, `critical_result.*` dengan matriks bawaan berprinsip hak minimum. Peran sistem baru
   `ahli_gizi` (peran sistem kini 17). Dokter mendapat `lab.worklist.read` lingkup unit (keputusan orkestrator 4.0c,
   agar dokter patologi klinis dengan `lab.result.release` bisa membuka layar Lab). `lab.analyzer.ingest` khusus
   perangkat (ADR-0027).
4. **Validasi klinis lab** oleh dokter berpenugasan di unit Lab, TTE atas snapshot kanonik (`lab_validations.snapshot_hash`)
   dengan mekanisme fase 3 (ADR-0029). Kewenangan Sp.PK spesifik menunggu B04.
5. **Penomoran** lab per hari (`day`) lewat layanan penomoran P08; **nilai lab** `numeric` di DB, angka di API.
6. **Aturan gerbang** penunjang di `packages/shared/src/rules/*` (lab, radiologi, farmasi, OK, darah): satu sumber
   untuk API, web, dan jalur demo; modul web lama (`penunjang*.ts`, `btn-ok.ts`) hanya me-re-export.
7. **Letak kontrak (4.0a).** Kontrak API penunjang di `schemas/penunjang-api.ts`; kontrak mode presentasi
   `schemas/penunjang.ts` tidak diubah (jalur demo dibekukan). Skema kamar operasi pindah ke `schemas/kamar-operasi.ts`;
   `btn.ts` me-re-export agar impor lama tetap jalan.
8. **Event domain penunjang** (25 event, `domain-events.ts`) bermuatan datar: ID + token enum, **tanpa kode baku**
   (LOINC/KFA/ICD). Pendengar membaca kode dari baris sumber lewat RLS, sesuai penjaga PHI event fase 2.
9. **Panel lab** dipetakan lewat `lab_test_definitions.panel_code` (`DL`, `KIMIA`, `ELEKTROLIT`, `LIPID`); orderable
   fase 3 belum punya kolom panel.
10. **S10 diagnostik lain** memakai `diagnostic_reports` fase 3 (muara hasil, keputusan fase 3 no. 12); kolom tambahan
    (jenis S10, isian P07) bila perlu ditambah di 4.8.

_Sumber butir 7–10 dan butir 3 (`ahli_gizi`, bukan `nutrisionis` seperti rencana awal no. 21; kode yang sama dengan PPA
CPPT fase 3): laporan A5 kepada orkestrator, 7 Okt 2026._

## Konsekuensi

- Kueri worklist wajib menyaring unit + jendela 7 hari di SQL sebelum `LIMIT`, sama seperti `patientAccessSql`.
- Akses penunjang tidak membuka seluruh rekam medis; layar penunjang memakai data minimal.
- Belum diterapkan di API sampai potongan 4.1a; tes isolasi + ABAC per modul wajib saat modul dibangun.
