# Rencana fase 4 · Penunjang (S01–S10)

> **Catatan perencana (berlaku untuk fase 4 dan 5):**
> Saya sudah menyusun kedua rencana di bawah. Struktur dan kedalamannya mengikuti `docs/rencana/fase-2-front-office.md`. Saya tidak mengubah berkas apa pun. Isinya bersandar pada pembacaan CLAUDE.md, docs/01–09, PROGRESS, ADR 0003/0004/0012/0017/0019/0020/0021/0023, mockup Lab/Farmasi/OK/Kasir/Klaim/Akuntansi, kontrak `schemas/{penunjang,keuangan,btn,klinis}.ts`, serta Server Action dan aturan demo di `apps/web/src/{app/(staf),lib,components}`.
>
> Ada tiga temuan yang menentukan rencana:
>
> - **Belum ada pemroses inbound sama sekali** di worker maupun API. Fase 4 membangunnya (4.1a), dan webhook TPDI di fase 6 nanti memakainya ulang.
> - **Event domain harus tersimpan di tabel.** Rencana fase 2 hanya menyebut "publisher event domain". Kalau event cuma dipancarkan di memori, event fase 3–4 hilang sebelum charge capture fase 5 sempat membacanya.
> - **`NUMBER_KINDS` hanya mengenal periode `none`/`month`.** Nomor lab harian butuh periode `day`. Selain itu nomor jurnal `JU-YYMM-NNNN` hanya muat 9.999 per bulan, jadi saya perlebar.

Disusun 5 Okt 2026. **Semua pilihan di §4 memakai opsi paling baku, aman, dan sederhana. Pemilik produk menyetujuinya otomatis 5 Okt 2026.**

- Nomor ADR 0034–0037 (dinomori ulang penggabung: fase 2 0025–0027, fase 3 0028–0032, 0033 batas laju Redis).
- Blok cap waktu migrasi `20261104HH0000`: 4.0b memakai HH 01–09, potongan berikutnya HH = 10 + urutan potongan.

## 1. Ringkasan

Fase 4 membangun backend nyata untuk:

- **S01 laboratorium:** worklist, spesimen berbarcode, input hasil manual dan dari analyzer HL7 yang disimulasikan mock, validasi teknis → klinis, delta check, QC dasar.
- **S09 nilai kritis:** alarm, timer 30 menit, pelaporan dengan read-back, eskalasi, metrik kepatuhan.
- **S03 radiologi:** order, jadwal modalitas, pelaksanaan (identitas, skrining kontras, dosis), ekspertise ber-TTE. PACS di fase lanjut.
- **S04 farmasi klinis:** telaah 3 aspek, CDS dievaluasi ulang saat telaah, intervensi apoteker ke dokter.
- **S05 dispensing dan stok depo:** batch/ED, FEFO, mutasi, retur, label dosis untuk pindai eMAR.
- **S06 kamar operasi:** jadwal kamar, checklist WHO terkunci berurutan, hitung kasa, laporan operasi, BHP.
- **S02, S07, S08, S10:** struktur dasar + order/hasil.

Layar presentasi Laboratorium, Farmasi, Radiologi, dan Kamar operasi disambungkan ke API (`DATA_SOURCE=api`). Jalur demo tetap hidup, dibekukan, dan diuji E2E demo (keputusan #4 fase 2).

Urutan pengerjaan:

1. Kontrak bersama, lalu skema DB. Fondasi web dikerjakan paralel dengan skema.
2. Infrastruktur: inbound generik, ingest analyzer, kerangka nilai kritis, SSE, job. Paralel dengan mock LIS, stok depo, dan kamar operasi.
3. Lab, radiologi, farmasi klinis, serta gizi dan bank darah paralel.
4. Nilai kritis penuh, dispensing, mikro/PA/diagnostik.
5. Penutup dengan E2E DoD.

**Prasyarat:**

- Fase 2 selesai:
  - `requireScreen` dan pemecahan data web per layar (0c)
  - SSE (ADR-0026)
  - prinsipal perangkat + `registered_devices` (ADR-0027)
  - publisher event domain (1b)
  - job P11 per tenant serta `defer`, `onDead`, dan kebijakan retry per operasi outbox (1a)
  - layanan antrean `F` dan mesin task ID (4a)
  - E2E stack dengan mock dan worker (1d)
- **Event domain tersimpan** append-only di `domain_events`: id UUID v7, tipe, `encounter_id`, `patient_id`, payload berisi ID tanpa PHI, waktu server. Bila fase 2/3 hanya memancarkan event di memori, 4.1a menambah tabel ini. Fase 5 dan 7 membaca ulang event fase 3–4 dari tabel ini.
- Fase 3 selesai dengan antarmuka di tabel berikut.
  - Nama di tabel mengikuti konsep. Bila fase 3 menamai lain, modul penunjang memakai adaptor tipis.
  - Tabel fase 3 tidak diubah; tambahan kolom hanya lewat migrasi fase 4.

**Antarmuka yang dibutuhkan dari fase 3**

| #     | Antarmuka                                                                                                                                                                                                                                                                                    | Dipakai            |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| F3-1  | Order penunjang (`service_requests`) dan katalog layanan (jenis, kode LOINC/ICD-9-CM, unit pelaksana), prioritas, pemesan, indikasi, `requisition_id` per kiriman CPOE. Service baca `OrdersQueryService.forPerformerUnit(unit, jenis, status)`. Event `order.placed` dan `order.cancelled`. | 4.2, 4.4, 4.7–4.9  |
| F3-2  | `medication_requests` berversi per `requisition_id` dan formularium RS (KFA, Fornas, high alert, golongan untuk CDS). Revisi dokter = versi baru + event `medication_request.revised`.                                                                                                       | 4.5, 4.6b          |
| F3-3  | Mesin CDS `CdsService.evaluate(konteks, item)` dan `cds_alerts` (tingkat, keputusan, override beralasan, konteks `prescribing` / `pharmacy_review`)                                                                                                                                          | 4.5                |
| F3-4  | Konteks klinis: alergi, berat badan, status hamil, DPJP, perawat penanggung jawab, bed terkini (ADT), status pulang                                                                                                                                                                          | 4.2–4.7            |
| F3-5  | eMAR memindai label dosis lewat `DispensingService.resolveLabel(barcode)`. Event `medication.administered` dengan tanda stok ruangan.                                                                                                                                                        | 4.6b               |
| F3-6  | `ConsentService.findSigned(encounterId, jenis, kodeProsedur?)`                                                                                                                                                                                                                               | 4.7                |
| F3-7  | Mekanisme TTE entri klinis yang dipakai resume: snapshot kanonik → `document_signatures` (ADR-0020)                                                                                                                                                                                          | 4.2, 4.4, 4.7, 4.8 |
| F3-8  | `PatientAccessService` dengan lingkup `unit` untuk pelaksana order (keputusan #3), plus daftar penerima notifikasi (DPJP, kepala ruangan)                                                                                                                                                    | semua              |
| F3-9  | Panel hasil (CPOE, ringkasan pasien K14, resume K13) membaca `ResultsQueryService` milik fase 4, bukan tabel langsung                                                                                                                                                                        | 4.2, 4.4, 4.8      |
| F3-10 | Peran `nutrisionis` untuk PPA gizi. Bila fase 3 tidak menambahkannya, 4.0a yang menambahkan.                                                                                                                                                                                                 | 4.9                |

**Diserahkan ke fase lain:**

- Event penunjang dipakai charge capture (fase 5) dan SATUSEHAT (fase 7).
- Task 6/7 dikirim lewat mesin task fase 2.
- Stok minimal dan `suppliers` dipakai U10 (fase 5), lalu dilengkapi B01 (fase 8).
- Pemroses inbound generik dipakai webhook TPDI (fase 6).

## 2. Potongan kerja (urut dependensi)

Aturan untuk semua tabel baru (sama dengan fase 2):

- `tenant_id` + RLS `FORCE`; FK komposit `(tenant_id, id)` dibungkus `NO FORCE`/`FORCE`.
- Role aplikasi tanpa hak DELETE/TRUNCATE.
- Uang `bigint`; waktu dari server.
- **Entri klinis append-only:** hasil, validasi, ekspertise, telaah, intervensi, laporan operasi, butir checklist, hitung kasa, laporan nilai kritis.
  - Dijaga `app_reject_mutation()`.
  - Koreksi lewat `version`, `supersedes_id`, dan `correction_reason`.
  - Versi terbaru dibaca lewat view `*_current` (`security_invoker`).
- **Data operasional** (status order, spesimen, kasus): hanya kolom status yang boleh di-UPDATE (hak kolom), dengan tabel riwayat append-only.

### 4.0a · Kontrak bersama (`packages/shared`)

**Katalog izin baru:**

- `lab.worklist` (read), `lab.specimen` (collect, receive, reject), `lab.result` (write, verify, release, correct), `lab.qc` (read, write), `lab.master` (write)
- `critical_result` (read, report, review)
- `radiology` (read, schedule, perform, report, sign)
- `pharmacy.review` (read, write), `pharmacy.dispense` (prepare, double_check, handover, return)
- `stock` (read, receive, transfer, adjust), `formulary` (write)
- `surgery` (read, schedule, checklist, count, report, override)
- `nutrition` (read, write), `blood_bank` (read, crossmatch, issue), `diagnostics` (write, sign)
- Izin perangkat: `lab.analyzer.ingest`

**Matriks bawaan:**

| Peran        | Izin                                                                                    | Lingkup                                                         |
| ------------ | --------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| analis_lab   | `lab.*` kecuali `release` dan `master`, `critical_result` read/report, `blood_bank`     | unit                                                            |
| radiografer  | `radiology` read/schedule/perform, `critical_result` read/report                        | unit                                                            |
| dokter       | `lab.result.release`, `radiology` report/sign, `diagnostics`                            | unit (hanya bila penugasannya di unit Lab/Radiologi/Diagnostik) |
| dokter       | `critical_result` read, `surgery` read/report/checklist/override                        | relationship                                                    |
| apoteker     | `pharmacy.*`, `stock` (kecuali adjust lintas depo), `formulary`                         | unit                                                            |
| perawat      | `lab.specimen.collect`, `critical_result` read, `nutrition`, `pharmacy.dispense.return` | relationship                                                    |
| perawat      | `surgery` checklist/count                                                               | unit OK                                                         |
| manajemen    | `critical_result.review`, `stock.read`                                                  | all                                                             |
| admin_tenant | `lab.master`, `formulary`                                                               | all                                                             |

**Penomoran (P08):**

- Tambah periode `day`.
- `lab_no`: `L` + YYMMDD + 4 digit, harian (regex kontrak sekarang `L\d{10}`).
- `rad_accession` `RAD-YYMM-NNNN`, `prescription_no` `R-YYMM-NNNN`, `surgery_case` `OK-YYMM-NNNN`, `stock_receipt` `TRM-YYMM-NNNN`, `stock_transfer` `MUT-YYMM-NNNN`, `blood_request` `BD-YYMM-NNNN`.

**Pengaturan (P12):**

- `critical.report_limit_minutes` (30), `critical.escalation_step_minutes` (30)
- `lab.tat_target_routine_minutes` (60), `lab.tat_target_cito_minutes` (45)
- `radiology.contrast_egfr_min` (30)
- `stock.expiry_warning_days` (90)
- `surgery.override_reason_min` (15), `pharmacy.override_reason_min` (10)

**Event domain** (nama + payload zod tanpa PHI; isinya ID, kode LOINC/KFA/ICD-9-CM, qty, unit, pelaksana):

- Lab: `lab.order_accepted`, `lab.specimen_received`, `lab.specimen_rejected`, `lab.result_released`, `lab.result_corrected`, `lab.test_voided`
- Nilai kritis: `critical_result.raised`, `critical_result.reported`, `critical_result.escalated`
- Radiologi: `radiology.exam_completed`, `radiology.report_signed`
- Farmasi dan stok: `pharmacy.service_started`, `pharmacy.dispensed`, `pharmacy.returned`, `stock.received`, `stock.adjusted`, `stock.transferred`
- Kamar operasi: `surgery.case_scheduled`, `surgery.incision_recorded`, `surgery.case_completed`, `surgery.case_cancelled`
- Lainnya: `blood.unit_issued`, `diagnostic.report_signed`, `micro.report_released`, `pa.report_signed`

**Aturan murni pindah ke `packages/shared/src/rules/{lab,pharmacy,radiology,surgery}.ts`.** Satu sumber dipakai API (berwenang), web (petunjuk), dan demo. Isinya:

- dari `apps/web/src/lib/penunjang.ts`: `labFlag`, `deltaCheck`, `criticalStage`, `criticalReportGate`, `validationBlock`
- dari `lib/penunjang-farmasi.ts`: `alertBlocks`, `blockingAlerts`, `telaahBlock`, gerbang cek ganda
- dari `lib/penunjang-radiologi.ts`: `radStartGate`, `radFinishGate`, `radSignGate`
- dari `lib/btn-ok.ts`: `incisionGate`, `canConfirmPhase`, `checkCounts`
- baru: `pickFefo`

**Revisi kontrak:**

- `schemas/penunjang.ts`:
  - ID menjadi UUID.
  - `elapsedSeconds` diganti `raisedAt` + `serverNow` (timer dihitung dari jam server).
  - Penerima nilai kritis berbentuk `{ userId } | { name, role }`.
  - Skema masukan (body API) per aksi.
- Skema OK dipindah dari `schemas/btn.ts` ke `schemas/kamar-operasi.ts`. `btn.ts` me-re-export sementara.
- Baru `integrations/lis/hl7.ts`:
  - parser/serializer HL7 v2.5 minimal (MSH, OBR, OBX, NTE), dengan segmen PID dan NK1 diredaksi
  - tanda tangan HMAC perangkat dengan pola `tpdi-signature`

### 4.0b · Skema DB + migrasi + seed (`packages/db`), setelah 4.0a

**Master:**

- `lab_test_definitions`: katalog F3-1, LOINC, jenis spesimen, satuan, desimal, tipe hasil, panel, kode analyzer, batas delta.
- `lab_reference_ranges`: per jenis kelamin × rentang umur (hari); rentang rujukan dan batas kritis.
- `lab_analyzers`: + `registered_device_id`.
- `radiology_modalities` (ruang di `locations`, slot per hari) dan `radiology_procedures` (ICD-9-CM, butuh kontras, templat ekspertise).
- `stock_locations` (depo/gudang/ruang/OK → `units`) dan `formulary_stock_profiles` (satuan, LASA, min/maks per depo).
- `suppliers`: minimal, dipakai U10.
- `surgery_checklist_templates`: berversi, beku setelah terbit (pola ADR-0019).
- `diet_types`, `blood_components`.

**S01/S09:**

- `lab_orders`: `lab_no` unik, service request, prioritas, status + `lab_order_status_history`.
- `specimens`: barcode unik; kumpul, terima, tolak; + `specimen_events`.
- `lab_results` append-only:
  - nilai `numeric` atau teks
  - **salinan** rentang rujukan dan batas kritis yang berlaku saat hasil masuk
  - flag dan delta (+ id hasil pembanding)
  - sumber `manual`/`analyzer` + `inbound_event_id`
  - status `preliminary`/`final`/`entered_in_error`
  - versi terbaru di `lab_results_current`
- `lab_validations` append-only: level teknis/klinis, hash snapshot, `signature_id`; unik per (order, level, versi).
- `lab_qc_runs` append-only: hasil Westgard ok/warn/reject.
- `critical_results`: sumber hasil lab atau ekspertise, salinan batas menit. Status hanya berubah lewat trigger saat laporan masuk.
- `critical_result_reports` append-only:
  - CHECK penerima = `recipient_user_id` ATAU (`recipient_name` ≥ 5 karakter + `recipient_role`)
  - CHECK `read_back_confirmed = true`
  - durasi diisi trigger dari `raised_at` ke `now()`
- `critical_result_escalations` append-only, unik per (kritis, level).

**S03:**

- `imaging_studies`:
  - accession, jadwal, status + riwayat, cek identitas, skrining kontras (JSON)
  - dosis: CHECK modalitas CT tidak bisa `completed` tanpa CTDIvol dan DLP
  - `study_instance_uid` nullable (PACS nanti)
- `imaging_reports`: append-only, addendum, view current.

**S02/S10:**

- `micro_isolates` dan `micro_susceptibilities` (S/I/R, MIC).
- `pa_reports` append-only.
- `diagnostic_reports` append-only: isian formulir P07 + dokumen P08.

**S04/S05:**

- `pharmacy_prescriptions`: per `requisition_id`, nomor R, depo, status + riwayat.
- `prescription_reviews` append-only.
- `pharmacist_interventions` dan `pharmacist_intervention_responses` append-only.
- `dispenses`: CHECK `double_checked_by <> prepared_by`.
- `dispense_items` append-only: batch, qty, barcode label, `fefo_override_reason`.
- `dispense_returns` append-only.

**Stok:**

- `stock_batches`: nomor batch, ED, harga pokok per satuan (bigint), pemasok; beku.
- `stock_balances`: lokasi × batch, CHECK `qty >= 0`, hanya diubah trigger.
- `stock_movements`: ledger append-only (jenis, qty bertanda, rujukan, alasan). Trigger memperbarui saldo pada baris yang sama dan menolak pengeluaran batch kedaluwarsa ke pasien.
- `stock_receipts`, `stock_transfers`, `stock_adjustments` (+ itemnya).

**S06:**

- `surgery_cases`:
  - nomor, kamar, rentang waktu
  - `EXCLUDE USING gist` per kamar untuk kasus aktif (extension `btree_gist`)
  - status + riwayat, prioritas, `consent_id`, versi templat checklist
- `surgery_case_team`.
- `surgical_safety_checks` append-only (butir).
- `surgical_safety_confirmations` append-only, unik per fase. Trigger menjaga:
  - urutan sign in → time out → sign out
  - semua butir fase tercentang sebelum konfirmasi
  - sign out butuh insisi tercatat dan hitung akhir cocok (atau tindakan selisih terdokumentasi)
- `surgery_events` append-only, unik per jenis: induksi, insisi, tutup, keluar. Trigger insisi: butuh time out, kecuali `override_reason` ≥ 15 karakter.
- `surgical_counts` append-only dan `surgery_count_discrepancies`.
- `operative_reports` append-only, ber-TTE.
- `surgery_supply_usages`: menulis movement `usage` dari depo OK.

**S07/S08:**

- `diet_orders` dan `meal_services` (sisa makanan).
- `blood_units`, `blood_requests`, `crossmatches` (append-only).
- `blood_issues`: trigger kompatibilitas ABO/Rh, crossmatch cocok, belum ED; jalur darurat sesuai keputusan #22.
- `transfusion_reactions` append-only.

**Helper:** `moveStock`, `pickFefo`, `raiseCritical`.

**Migrasi data izin:** izin baru masuk ke peran RS yang sudah ada (pola fase 2).

**Seed (fiktif):**

- Lab: tes DL/kimia/elektrolit/HbA1c/lipid. Ke-18 kode LOINC dari layar demo sudah ada di `SEED_REF_SAMPLES`.
- Rentang rujukan dan batas kritis (mis. K > 6,0); 2 analyzer tanpa merek.
- 4 modalitas.
- Depo: Farmasi RJ, RI, IGD, OK, Gudang. Batch dengan ED berbeda: satu kedaluwarsa, satu dekat ED.
- Pemasok fiktif; 4 kamar OK; templat WHO v1 (5 butir per fase, sama dengan mockup).
- Jenis diet; kantong darah.

**Tes db:**

- RLS untuk setiap tabel.
- Append-only, juga terhadap pemilik tabel.
- 20 dispensing serentak untuk sisa 5 unit → tepat 5 berhasil, dan saldo = Σ ledger.
- Batch ED ditolak.
- Urutan checklist dan gerbang insisi oleh trigger.
- CHECK read-back.
- Jadwal kamar tumpang tindih ditolak.
- Cek ganda oleh penyiap ditolak.
- Kompatibilitas darah.

### 4.0c · Fondasi web penunjang (paralel dengan 4.0b)

- **ID fixture:** ID bernama pasien di `lib/demo/fixtures/penunjang.ts` dan kasus OK (`lab-endang`, `rx-endang`, `rad-hendro`, `ok2-2`) diganti UUID konstan, bila 0c fase 2 belum mencakupnya. Regex ID di action ikut diubah.
- **Data per layar:** `lib/server/data/penunjang.ts` dipecah menjadi `lab.ts`, `farmasi.ts`, `radiologi.ts`, `kamar-operasi.ts`. `getOrSchedule` keluar dari `data/btn.ts`.
- **OK pindah namespace** agar tidak bentrok dengan fase 6:
  - `lib/btn-ok.ts` → `lib/penunjang-ok.ts`
  - `components/btn/ok-{gantt,checklist,count,incision}.tsx` → `components/penunjang/ok-*.tsx`
- **Halaman:**
  - Isi lama pindah ke `demo-page.tsx` dan `demo-actions.ts`.
  - `page.tsx` memilih jalur lewat `requireScreen(id)`.
  - `lib/penunjang*.ts` tinggal fungsi tampilan; aturan diimpor dari `@simrs/shared/rules`.
- **E2E demo** `e2e/demo/penunjang.spec.ts` dan `semua-layar.spec.ts` tetap hijau.

### 4.1a · Infrastruktur penunjang (API + worker)

- **Inbound generik di worker** (dipakai ulang webhook TPDI fase 6):
  - siklus `inbound_events`: `received → processing → processed | failed | dead`
  - retry eksponensial, handler per `source`
  - hasil diproses atomik (pola ADR-0017), status terlihat
- **Ingest analyzer:** `POST /api/v1/devices/lis/hl7`
  - prinsipal perangkat (ADR-0027) dengan izin `lab.analyzer.ingest`
  - HMAC atas `timestamp.body`, timestamp ≤ 5 menit
  - idempotency = MSH-10
  - PID/NK1 diredaksi sebelum disimpan
  - balas `ACK AA` (artinya diterima, belum diproses) secepatnya
  - batas 256 KB, rate limit per perangkat
- **Kerangka modul:** `lab`, `critical-results`, `radiology`, `pharmacy-clinical`, `dispensing`, `surgery`, `micro-pa`, `diagnostics`, `nutrition`, `blood-bank`, ditambah `ResultsQueryService` (F3-9).
- **Nilai kritis:** `CriticalResultsService.raise()` (dipakai lab dan radiologi) dan gerbang `hasOpenCritical(orderId)`.
- **Kanal SSE** (ADR-0026), payload hanya ID + status: `lab.worklist:<unit>`, `pharmacy.queue:<unit>`, `surgery.board:<tanggal>`, `critical:<user>`.
- **Event:** tipe event fase 4 didaftarkan ke publisher. Tabel `domain_events` dibuat bila belum ada (lihat prasyarat).
- **Job P11:**
  - eskalasi nilai kritis tiap menit, idempoten per level
  - tanda batch dekat ED/kedaluwarsa, harian 00.05 WIB
  - stok di bawah minimum, harian
- **Tes:**
  - perangkat ditolak 403 di endpoint staf; staf ditolak 403 di ingest
  - tanda tangan salah/kedaluwarsa → 401 tanpa menyimpan apa pun
  - HL7 ganda → satu event
  - PID tidak tersimpan
  - SSE tidak bocor antar-tenant maupun antar-unit

### 4.1b · Mock analyzer LIS (`apps/mock/src/systems/lis.ts`)

- **Panel:** kirim ORU^R01 untuk barcode X dengan templat DL, kimia, elektrolit, atau lipid. Skenario: normal, kritis (K 6,8), delta kreatinin, sebagian tertunda. Juga: kirim ganda, tanda tangan salah, barcode tak dikenal, latensi.
- **Konfigurasi:** target `LIS_HL7_TARGET` (pola `TPDI_WEBHOOK_TARGET`); kunci perangkat dari env lokal.
- **E2E:** helper `mock.lis.send(barcode, templat)` + reset.
- **Tes:** kontrak memakai parser shared.

### 4.2 · S01 Laboratorium inti

- **Komponen:** S01, ditambah sisi pemicu S09.
- **API `/api/v1/lab`:**
  - `GET worklist`: order F3-1 untuk unit lab + `lab_orders`; filter, kursor. Izin `lab.worklist:read` lingkup unit.
  - `POST orders`: terima service request → `lab_order`, nomor lab, spesimen, label barcode. Idempotency-Key per request.
  - `POST specimens/:id/collect|receive|reject`: penolakan wajib alasan → event + notifikasi ruangan "sampel ulang".
  - `GET orders/:id`: hasil terkini + 5 hasil sebelumnya dari kelompok RM (`app_patient_group`).
  - `POST orders/:id/results`: input manual. Flag, delta, dan status kritis dihitung server dari rentang usia/JK saat itu. Hasil kritis memanggil `raise()`.
  - `POST orders/:id/validations {level}`:
    - **teknis** (`lab.result:verify`) ditolak 409 bila hasil belum lengkap, bila nilai kritis masih terbuka (`CRITICAL_OPEN`), atau bila QC hari itu ditolak dan tidak ada alasan override
    - **klinis** (`lab.result:release`, dokter berpenugasan di unit lab) hanya setelah teknis → TTE (F3-7) → event `lab.result_released` → notifikasi DPJP tanpa PHI
  - `POST results/:id/corrections`: alasan wajib. Hasil yang sudah rilis menjadi "dikoreksi" dan DPJP diberi notifikasi.
  - `GET/POST qc`: Westgard 1-2s = peringatan, 1-3s dan 2-2s = tolak.
  - `GET orders/:id/print`: HTML, audit `print`, watermark.
  - Handler inbound `lis-hl7`: cocokkan barcode di OBR → hasil `preliminary` bersumber analyzer. Barcode tak dikenal → `failed`, tampil di layar (bukan DLQ diam-diam).
  - `ResultsQueryService.latest(kelompok RM, loinc[])` termasuk eGFR terhitung (dipakai farmasi dan radiologi).
- **Audit:**
  - daftar kerja: `search` per pasien saat dimuat (pola ADR-0015); pembaruan SSE tanpa PHI tidak diaudit
  - detail: `read`
  - input, validasi, koreksi: `create` / `correct`
  - cetak: `print`
- **Outbox/mock:** TTE (P08), notifikasi (P09), mock 4.1b.
- **Web:**
  - `app/(staf)/penunjang/lab/{page.tsx,actions.ts}` → API
  - `components/penunjang/lab-{workspace,worklist,detail,results-table,flow}.tsx` membaca kontrak API
  - chip analyzer "terhubung" bila pesan terakhir ≤ 15 menit
  - KPI TAT dihitung server
- **Tes:**
  - isolasi tenant
  - 403: kasir/radiografer tidak bisa input; analis tidak bisa rilis klinis; dokter di luar unit lab tidak bisa rilis
  - rentang rujukan per usia/JK; delta check
  - koreksi berversi
  - ORU ganda tidak menggandakan hasil
  - validasi teknis diblokir selama kritis terbuka
  - entri audit tercatat
- **DoD:** nilai kritis (pemicu dan gerbang).

### 4.3 · S09 Nilai kritis penuh

- **API `/api/v1/critical-results`:**
  - `GET`: lingkup unit untuk lab/radiologi, relationship untuk DPJP/perawat.
  - `GET :id`: timer dari `raisedAt` + `serverNow`.
  - `POST :id/reports` (`critical_result:report`):
    - penerima = staf aktif yang dipilih (dari DPJP/perawat ruangan, F3-4), atau nama + peran bila penerima di luar daftar
    - saluran (telepon/langsung), teks read-back, `readBackConfirmed: true` wajib
    - pelanggaran → 422 `CRITICAL_RECIPIENT_REQUIRED` / `CRITICAL_READBACK_REQUIRED`
    - durasi dihitung server
    - **tidak ada endpoint penutupan lain**
  - `POST :id/acknowledge`: konfirmasi opsional oleh penerima dari notifikasinya.
  - `GET metrics?from&to&unit` (`critical_result:review`): jumlah, % ≤ batas, median, p90.
- **Eskalasi** (job 4.1a), lewat in-app + WhatsApp mendesak tanpa PHI (ADR-0021):
  - pada batas waktu: kepala unit pelapor + DPJP + kepala ruangan
  - batas + 30 menit: manajemen/komite mutu
- **Radiologi:** temuan kritis dari ekspertise memakai jalur yang sama.
- **Web:**
  - `components/penunjang/lab-{critical-banner,critical-form,readback-confirm}.tsx` → API: pilih penerima dari daftar staf atau isi manual; timer memakai jam server
  - lonceng notifikasi menaut ke detail
  - status registri `lab` → `api`
- **Tes:**
  - penutupan tanpa penerima/read-back ditolak di API dan di DB (CHECK)
  - durasi memakai jam server walau klien mengirim waktu
  - eskalasi sekali per level walau job berjalan ganda
  - notifikasi tanpa PHI
  - metrik ≤ 30 menit dihitung benar
  - isolasi; 403 untuk kasir
- **DoD:** nilai kritis.

### 4.4 · S03 Radiologi

- **API `/api/v1/radiology`:**
  - worklist dari F3-1
  - `POST studies`: terima + accession + slot modalitas; bentrok slot → 409
  - `POST studies/:id/start`, gerbang server:
    - identitas dua pengenal dicentang
    - prosedur kontras: alergi kontras (F3-4), eGFR ≥ pengaturan (dari `ResultsQueryService`), kehamilan untuk perempuan 12–55 tahun
    - override hanya dokter, wajib alasan
  - `POST :id/complete`: CT wajib CTDIvol + DLP (juga dijaga CHECK DB)
  - `POST :id/reports`: draf/final dengan templat
  - `POST :id/reports/:rid/sign`: dokter berpenugasan unit radiologi → TTE
  - addendum
  - tanda temuan kritis → `raise()`
- **Event:** `radiology.exam_completed`, `radiology.report_signed`.
- **PACS:** `study_instance_uid` kosong; tombol "Lihat citra" nonaktif berlabel.
- **Web:** `app/(staf)/penunjang/radiologi/*` dan `components/penunjang/rad-*.tsx` → API; status registri `rad` → `api`.
- **Tes:**
  - dosis CT wajib (API + DB)
  - skrining kontras
  - radiografer tidak bisa menandatangani
  - koreksi setelah TTE = addendum
  - isolasi, 403, audit
- **DoD:** aturan umum.

### 4.5 · S04 Farmasi klinis

- **API `/api/v1/pharmacy`:**
  - antrean per `requisition_id` (F3-2), tab telaah/siap/serah
  - `POST prescriptions`: terima → nomor R → `pharmacy.service_started` (task 6 untuk RJ BPJS ber-booking)
  - `POST :id/cds/evaluate`: F3-3 dengan konteks terkini (eGFR, BB, alergi)
  - `POST :id/alerts/:alertId/decision`: konfirmasi, override beralasan ≥ 10 karakter, atau usul
  - `POST :id/interventions`: notifikasi dokter penulis. Dokter menjawab di CPOE → versi baru (F3-2) → antrean diperbarui. **Apoteker tidak mengubah resep.**
  - `POST :id/reviews`: telaah administratif/farmasetik/klinis.
    - `setujui` → 409 `CDS_UNRESOLVED` selama ada peringatan mayor/sedang terbuka, atau override dokter atas peringatan mayor belum ditinjau
    - `tahan` / `sebagian` wajib alasan
  - MESO dasar lewat formulir P07
- **Web:**
  - `components/penunjang/farmasi-{queue,detail,telaah,cds,items}.tsx` dan `penunjang/farmasi/{page.tsx,actions.ts}` → API
  - `use-rx-local.ts` hanya untuk demo
- **Tes:**
  - setujui diblokir CDS terbuka
  - override tanpa alasan → 400
  - intervensi tidak mengubah resep
  - isolasi; 403 untuk perawat; audit
- **DoD:** aturan umum. CDS penuh adalah DoD fase 3.

### 4.6a · S05 Stok depo (B01 minimal)

- **API `/api/v1/stock`:**
  - saldo per depo/item/batch; kartu stok (ledger)
  - `POST receipts`: pemasok, no. faktur, batch, ED, qty, harga pokok bigint → `stock.received`
  - `POST transfers`: dua langkah, kirim lalu terima
  - `POST adjustments`: wajib alasan
  - daftar batch dekat ED
- **Web:** kolom stok depo di Farmasi diambil dari API (dirangkai 4.5). Layar Logistik tetap demo (fase 8).
- **Tes:**
  - properti: saldo = Σ ledger
  - stok tidak pernah negatif di bawah transaksi serentak
  - transfer setengah jalan tidak menggandakan stok
  - batch ED ditolak
  - isolasi, 403
- **DoD:** stok.

### 4.6b · S05 Dispensing

- **API `/api/v1/dispensing`:**
  - `POST prescriptions/:id/prepare`:
    - FEFO otomatis per item; memilih batch lain wajib `fefoOverrideReason`
    - ledger `dispense` di transaksi yang sama
    - etiket + barcode dosis; UDD rawat inap per jadwal dosis
  - `POST dispenses/:id/double-check`: apoteker kedua dari **sesinya sendiri**, bukan penyiap. Wajib sebelum serah bila ada item high alert.
  - `POST dispenses/:id/handover`: penerima + nama + PIO; RJ memanggil antrean `F` → `pharmacy.dispensed` (task 7, charge fase 5).
  - `POST dispenses/:id/returns`: barang layak kembali ke stok; tidak layak dihapusbukukan (`write_off`) → `pharmacy.returned`.
  - `GET labels/:barcode` untuk eMAR (F3-5).
- **Web:** `components/penunjang/farmasi-{work,double-check,parts}.tsx` + `penunjang/farmasi/dispense-actions.ts` → API; etiket dicetak HTML; status registri `farmasi` → `api`.
- **Tes:**
  - batch ED terdekat keluar dulu
  - override FEFO tanpa alasan → 400
  - `BATCH_EXPIRED` dan `STOCK_INSUFFICIENT` → 409
  - `DOUBLE_CHECK_SAME_USER` → 409
  - serah high alert tanpa cek ganda → 409
  - retur memulihkan saldo
  - task 7 `sent` ke mock BPJS
  - isolasi, 403
- **DoD:** stok.

### 4.7 · S06 Kamar operasi

- **API `/api/v1/surgery`:**
  - papan 4 kamar per tanggal; daftar tunggu
  - `POST cases`: bentrok kamar → 409 `ROOM_OVERLAP`
  - tim; batal wajib alasan
  - `POST cases/:id/checklist/items`: butir "persetujuan tindakan" diisi sistem dari F3-6 dan tidak bisa dicentang manual
  - `POST cases/:id/checklist/confirm {phase}`: 409 `CHECKLIST_INCOMPLETE` / `CHECKLIST_ORDER`
  - `POST cases/:id/events`:
    - induksi butuh sign in
    - insisi butuh time out → 409 `TIMEOUT_REQUIRED`
    - atau `overrideReason` ≥ 15 karakter oleh pemegang `surgery:override` → tercatat, notifikasi komite mutu, ditandai untuk ditinjau
  - `POST cases/:id/counts`: awal/tambahan/akhir; selisih wajib ditindaklanjuti sebelum sign out
  - `POST cases/:id/supplies`: BHP/implan → stok depo OK
  - `POST cases/:id/reports`: laporan operasi (dx pra/pasca ICD-10, ICD-9-CM, temuan, komplikasi, perdarahan, implan, spesimen PA → order S02) + TTE operator
  - asesmen pra-anestesi dan catatan anestesi lewat formulir P07 (diseed)
- **Event:** `surgery.case_completed` (prosedur, durasi, kamar, tim, BHP), `surgery.incision_recorded`.
- **Web:** `app/(staf)/penunjang/kamar-operasi/{page.tsx,actions.ts,ok-client.tsx}` dan `components/penunjang/ok-*.tsx` → API; KPI utilisasi/on-time/pembatalan dari server; status registri `ok` → `api`.
- **Tes:**
  - konfirmasi time out sebelum semua butir → 409
  - insisi sebelum time out → 409
  - override < 15 karakter → 400
  - override tercatat + audit + notifikasi
  - sign out ditolak bila hitung beda
  - dua konfirmasi serentak → hanya satu
  - tumpang tindih kamar → 409
  - urutan juga ditegakkan DB (uji SQL langsung)
  - isolasi; 403 untuk kasir dan apoteker
- **DoD:** time out dan insisi.

### 4.8 · S02 Mikrobiologi/PA + S10 diagnostik lain

- **S02:**
  - kultur: inkubasi → laporan awal → laporan akhir
  - isolat (daftar organisme lokal); uji kepekaan S/I/R + MIC; validasi seperti lab
  - PA: makro/mikro/diagnosis + gambar (P08) + TTE
  - `GET micro/antibiogram` sebagai sumber PPRA (fase 8)
- **S10:** EKG, USG, echo, endoskopi, treadmill = order F3-1 + isian P07 (5 formulir diseed) + lampiran P08 + TTE → `diagnostic.report_signed`.
- **Web:** tab "Mikrobiologi" di layar Lab. Hasil S10 tampil di panel hasil fase 3 (F3-9).
- **Tes:** append-only, versi, TTE, isolasi, 403.

### 4.9 · S07 Gizi + S08 Bank darah

- **S07:** order diet → daftar makan per ruang × jam makan (cetak HTML), label makanan, sisa makanan. Asuhan gizi lewat formulir P07.
- **S08:**
  - permintaan darah, stok kantong, crossmatch
  - pengeluaran: ABO/Rh kompatibel + crossmatch cocok + belum ED (darurat: keputusan #22)
  - reaksi transfusi; event `blood.unit_issued`
- **Web:** tanpa layar (keputusan #1).
- **Tes:** tabel kompatibilitas darah, append-only, isolasi, 403.

### 4.10 · Penutup fase 4

- **E2E DoD** (stack penuh + mock LIS + worker):
  1. Order lab → terima → mock ORU K 6,8 → KRITIS + timer → validasi ditolak → lapor tanpa read-back ditolak → lapor dengan penerima + read-back → tertutup, durasi tampil, metrik naik.
  2. Resep → telaah → siapkan (batch ED terdekat) → serah → stok depo berkurang; batch kedaluwarsa tidak ditawarkan; task 6/7 `sent`.
  3. OK: konfirmasi time out nonaktif di layar dan API membalas 409 sebelum semua butir; insisi terkunci sebelum time out; override beralasan tercatat.
- Juga: regresi E2E demo, `/review-keamanan`, ADR, `docs/panduan`, PROGRESS, QA visual.

## 3. Paralelisasi (maks. 4 agen sekaligus)

- 4.0a berjalan sendiri.
- **Gelombang A:** 4.0b ∥ 4.0c.
- **Gelombang B:** 4.1a ∥ 4.1b ∥ 4.6a ∥ 4.7.
- **Gelombang C:** 4.2 ∥ 4.4 ∥ 4.5 ∥ 4.9.
- **Gelombang D:** 4.3 ∥ 4.6b ∥ 4.8, lalu 4.10.
- Jalur kritis: 4.0a → 4.0b → 4.1a → 4.2 → 4.3 → 4.10.

**Aturan kepemilikan berkas:**

- Kontrak shared (`authz.ts`, `numbering.ts`, `settings.ts`, `schemas/penunjang.ts`, `rules/*`) milik 4.0a, lalu dibekukan. Perubahan setelahnya hanya oleh agen penggabung, satu baris per potongan.
- `schema.prisma` milik 4.0b. Potongan berikutnya hanya menambah model di akhir bagian domainnya, dengan migrasi di bloknya sendiri.
- Satu modul API, satu berkas tes API (`apps/api/test/<modul>.test.ts`), dan satu folder layar per potongan.
- Layar Lab:
  - `page.tsx` dan `actions.ts` milik 4.2
  - `lab-critical-*` dan `critical-actions.ts` milik 4.3
  - tab mikro milik 4.8
- Layar Farmasi:
  - `page.tsx`, `actions.ts`, telaah/CDS/items milik 4.5
  - work/double-check dan `dispense-actions.ts` milik 4.6b
- Peta yang diubah satu baris per potongan: `app.module.ts`, `operations.ts` / peta handler inbound, `screens.ts`, `nav.ts`.
- `apps/mock/src/systems/lis.ts` milik 4.1b.
- `e2e/demo/*` hanya diubah 4.0c dan 4.10.
- PROGRESS, panduan, dan penomoran ADR hanya oleh agen penggabung.

## 4. Keputusan (semua diambil dan disetujui otomatis 5 Okt 2026)

1. **S02/S07/S08/S10 tanpa mockup:** **struktur dasar + API. Mikro jadi tab di Lab, S10 tampil di panel hasil fase 3, gizi dan bank darah tanpa layar (cetak HTML)** (keputusan diambil, disetujui otomatis 5 Okt 2026). Alternatif: layar baru tanpa mockup.
2. **Worklist penunjang:** **query atas order fase 3; entitas kerja (`lab_orders`, `imaging_studies`, `pharmacy_prescriptions`) dibuat saat unit menerima order** (keputusan diambil, disetujui otomatis 5 Okt 2026). Alternatif: menyalin order lewat event.
3. **ABAC penunjang:** **lingkup `unit` = order yang ditujukan ke unit penugasan, selama order aktif + 7 hari setelah selesai. Data pasien yang tampil minimal: banner + data klinis relevan (eGFR, BB, alergi)** (keputusan diambil, disetujui otomatis 5 Okt 2026). Alternatif: relasi eksplisit per order di `access_relationships`.
4. **Analyzer:** **HL7 v2 ORU^R01 lewat HTTP ke endpoint perangkat ber-HMAC, disimpan di `inbound_events` dengan PID diredaksi, diproses async. MLLP/ASTM dan gateway edge menunggu I06** (keputusan diambil, disetujui otomatis 5 Okt 2026). Alternatif: worker menarik data dari mock.
5. **Hasil analyzer:** **selalu `preliminary`; tanpa autoverifikasi; validasi dua tahap oleh manusia** (keputusan diambil, disetujui otomatis 5 Okt 2026).
6. **Validasi klinis:** **dokter berpenugasan di unit Lab, dengan TTE atas snapshot kanonik memakai mekanisme fase 3. Kewenangan Sp.PK spesifik menunggu B04** (keputusan diambil, disetujui otomatis 5 Okt 2026).
7. **Gerbang validasi teknis:** **nilai kritis yang belum dilaporkan memblokir tanpa override. QC ditolak (Westgard 1-3s/2-2s) memblokir kecuali ada override beralasan** (keputusan diambil, disetujui otomatis 5 Okt 2026).
8. **Nilai kritis** (keputusan diambil, disetujui otomatis 5 Okt 2026):
   - **penerima = staf terpilih atau nama + peran; read-back wajib (API + CHECK)**
   - **batas 30 menit dari pengaturan; durasi dari waktu server sejak hasil masuk**
   - **eskalasi pada batas dan +30 menit; notifikasi in-app + WhatsApp tanpa PHI**
9. **Stok:** **ledger append-only; saldo dijaga trigger + CHECK ≥ 0; FEFO otomatis, override wajib alasan; batch ED diblokir; harga pokok per batch dalam bigint (biaya FIFO = urutan FEFO)** (keputusan diambil, disetujui otomatis 5 Okt 2026).
10. **B01 minimal di fase 4:** **penerimaan tanpa PO, mutasi dua langkah, penyesuaian beralasan. PO, ROP, dan opname penuh di fase 8** (keputusan diambil, disetujui otomatis 5 Okt 2026).
11. **Titik tagih obat:** **saat diserahkan (dispense), retur mengkredit. eMAR hanya untuk stok ruangan** (keputusan diambil, disetujui otomatis 5 Okt 2026).
12. **Cek ganda high alert:** **apoteker kedua dari sesinya sendiri** (keputusan diambil, disetujui otomatis 5 Okt 2026). Alternatif: PIN di perangkat yang sama (menunggu 10c-2).
13. **Jadwal OK:** **`EXCLUDE USING gist` (extension `btree_gist`)** (keputusan diambil, disetujui otomatis 5 Okt 2026). Alternatif: advisory lock + pengecekan aplikasi.
14. **Checklist WHO** (keputusan diambil, disetujui otomatis 5 Okt 2026):
    - **templat berversi per RS; urutan dan kelengkapan dijaga trigger DB**
    - **butir persetujuan tindakan diisi sistem dari data consent**
    - **override insisi hanya oleh dokter (`surgery:override`), alasan ≥ 15, ditinjau mutu**
    - **sign out tanpa override diam-diam**
15. **Radiologi:** **tanpa PACS/DICOM MWL di fase 4; accession siap untuk itu** (keputusan diambil, disetujui otomatis 5 Okt 2026).
16. **SATUSEHAT:** **fase 4 hanya mencatat event tanpa PHI; pengiriman di fase 7 dari `domain_events`** (keputusan diambil, disetujui otomatis 5 Okt 2026).
17. **Task ID 6/7:** **dari event farmasi lewat mesin task fase 2** (keputusan diambil, disetujui otomatis 5 Okt 2026).
18. **Penomoran:** **periode `day` di P08 untuk nomor lab** (keputusan diambil, disetujui otomatis 5 Okt 2026).
19. **Nilai lab:** **`numeric` di DB, angka di API** (keputusan diambil, disetujui otomatis 5 Okt 2026).
20. **Organisme mikro:** **daftar lokal; pemetaan SNOMED setelah P06 punya SNOMED** (keputusan diambil, disetujui otomatis 5 Okt 2026).
21. **Ahli gizi:** **peran `nutrisionis`, ditambahkan 4.0a bila fase 3 belum** (keputusan diambil, disetujui otomatis 5 Okt 2026).
22. **Darah darurat:** **tanpa crossmatch hanya kantong golongan O (Rh-negatif bila ada) dengan alasan dokter, crossmatch menyusul. Kantong ABO-inkompatibel tidak pernah keluar** (keputusan diambil, disetujui otomatis 5 Okt 2026).
23. **Aturan gerbang:** **dipindah ke `packages/shared/rules`, satu sumber untuk API, web, dan demo** (keputusan diambil, disetujui otomatis 5 Okt 2026).
24. **Jalur demo:** **dipertahankan dan dibekukan; layar OK pindah dari namespace `btn`** (keputusan diambil, disetujui otomatis 5 Okt 2026).
25. **ADR:** **blok 0034–0037** (keputusan diambil, disetujui otomatis 5 Okt 2026):
    - (a) worklist dan ABAC penunjang
    - (b) ingest analyzer
    - (c) ledger stok + FEFO
    - (d) gerbang keselamatan penunjang di DB

## 5. Risiko dan utang yang ditangani

- **Antarmuka fase 3 belum final** → adaptor tipis, tes kontrak per F3-n, daftar antarmuka diserahkan ke perencana fase 3.
- **Event tidak tersimpan** → tabel `domain_events` diwajibkan sejak 4.1a. Tanpanya charge capture fase 5 kehilangan event fase 3–4.
- **Belum ada pemroses inbound** → dibangun generik di 4.1a, dipakai ulang di fase 6.
- **Hot row stok** (obat laris) → baris per batch, transaksi pendek, tes 20 transaksi serentak.
- **`btree_gist` di Postgres portabel** → diverifikasi di 4.0b; cadangan: advisory lock per kamar.
- **Eskalasi bergantung worker** → timer layar tetap dari jam server; `/ready` memperingatkan bila job tertinggal.
- **No. HP DPJP kosong** → in-app saja + tanda "kanal WhatsApp tidak tersedia".
- **PHI di HL7 nyata** → redaksi PID; pencocokan hanya lewat barcode.
- **Banjir audit/SSE dari worklist** → SSE tanpa PHI, audit hanya saat halaman dimuat. Ambang anomali volume per peran masih utang P05.
- **Utang tersisa:**
  - kewenangan klinis Sp.PK/radiolog (B04)
  - Westgard sederhana
  - PACS/MWL, MLLP/ASTM (I06)
  - PO/ROP/opname (B01, fase 8)
  - generator PDF (P12): cetak masih HTML
  - layar gizi dan bank darah
  - SNOMED organisme
- **ID fixture bernama pasien** → UUID (4.0c).
- **Drift jalur demo** → E2E demo di 4.0c dan 4.10.

## 6. Definisi selesai fase 4 → potongan

| Kriteria                                                                                         | Potongan                           |
| ------------------------------------------------------------------------------------------------ | ---------------------------------- |
| Nilai kritis tidak bisa ditutup tanpa penerima + read-back; durasi lapor terukur                 | 4.0b, 4.1a, 4.1b, 4.2, 4.3, 4.10   |
| Stok berkurang saat dispensing; batch ED terdekat keluar dulu                                    | 4.0b, 4.6a, 4.6b, 4.10             |
| Time out tidak bisa dikonfirmasi sebelum semua item; insisi terkunci sebelum time out            | 4.0b, 4.7, 4.10                    |
| Aturan umum: migrasi, seed, tes izin + isolasi, audit, teks Indonesia, lint/typecheck/test hijau | setiap potongan; diperiksa di 4.10 |

---
