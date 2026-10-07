# Rencana fase 3 · Klinis RME (K01–K15)

Disusun 5 Okt 2026. **Disetujui otomatis 5 Okt 2026 sesuai mandat pemilik produk** (semua keputusan di §4 memakai opsi paling baku, aman, dan sederhana). Nomor ADR fase 3: 0028–0032 (0024–0027 dipakai fase 1–2).

## 1. Ringkasan

Fase 3 membangun rekam medis elektronik klinis di atas pondasi fase 2: `encounters`, `practitioners`, `coverages`/`seps`, `queue_tickets`/`queue_calls` + kait task 4/5, publisher event domain, SSE (ADR-0026), prinsipal perangkat, `onDead`, P11, dan cetak HTML.

Cakupan:

- **Encounter klinis dan worklist:** worklist (K01), pemeriksaan rawat jalan (K02), IGD + triase (K03), ADT + papan bed + Aplicare (K04/K05).
- **Catatan klinis:** asesmen (K06), CPPT multi-PPA dengan co-sign residen dan serah terima SBAR (K07), diagnosis/prosedur/alergi/problem list (K08).
- **Order dan obat:** CPOE + order set + CDS (K09), eMAR dengan pindai gelang + askep + EWS (K12).
- **Kolaborasi dan persetujuan:** konsultasi/rawat bersama (K10), persetujuan tablet + TTE (K11).
- **Dokumen dan ringkasan:** resume + rekonsiliasi obat + TTE (K13), ringkasan pasien (K14), mekanisme paket formulir (K15).

Rekaman untuk fase lain: peristiwa SATUSEHAT dicatat sekarang (status `held`, dikirim di fase 7) dan peristiwa biaya dicatat untuk fase 5. Ketujuh layar demo disambungkan ke API (`DATA_SOURCE=api`); jalur demo dipertahankan dan dibekukan (keputusan fase 2 no. 4).

Urutan pengerjaan:

1. Kontrak + mesin aturan bersama.
2. Skema DB (dua potongan berurutan); fondasi web berjalan paralel.
3. Infrastruktur API klinis.
4. Lima modul domain paralel.
5. eMAR, resume, dan konsultasi.
6. Sambungan layar per gelombang.
7. Penutup dengan E2E dua alur, rawat jalan dan IGD → ranap.

**Prasyarat:**

- DoD fase 2 hijau.
- Perbaikan demo klinis/rawat inap agen B/C sudah tergabung (payload eMAR/CPPT, gerbang gelang per dosis, tablet persetujuan).
- Data rujukan masih 72 kode contoh. Kode baku tidak dikarang; dataset resmi diimpor operator.

## 2. Potongan kerja (urut dependensi)

Aturan untuk semua tabel klinis:

- Pola standar: `tenant_id`, RLS `FORCE`, FK komposit, tanpa DELETE.
- Versi: `root_id`, `version`, `supersedes_id` (UNIQUE: satu pengganti per versi, sehingga dari dua koreksi serentak satu mendapat 409).
- `status` hanya `final` atau `entered_in_error`. Koreksi wajib `correction_reason` (CHECK ≥ 10 = `SAFETY_REASON_MIN`). Tambahan informasi lewat `addendum_of`.
- Dua stempel waktu (MRMIK 8b): `occurred_at` diisi PPA, `recorded_at` dari server dan tidak bisa diubah. Selisih melebihi `clinical.late_entry_hours` ditandai "entri terlambat".
- Penulis selalu dari sesi (8a): `author_user_id`, `author_role`.
- Hak DB: GRANT hanya SELECT/INSERT. Trigger `app_reject_mutation` berlaku juga untuk pemilik tabel.
- Trigger `app_clinical_guard`: rantai versi satu root/pasien/encounter, `version = prev + 1`, versi ber-TTE tidak bisa digantikan (hanya addendum).
- Baca lewat view `<tabel>_current` (`security_invoker`). Riwayat pasien selalu lewat `app_patient_group` (ADR-0016).

### 3.0a · Kontrak dan mesin aturan bersama (`packages/shared`)

**Izin baru:**

- `clinical`: read, write, correct, cosign, sign.
- `order`: read, write, cancel, manage (`manage` untuk order set institusi dan basis CDS).
- `medication.administer`, `triage.write`, `bed` (read, write), `consent` (read, write, sign), `result` (read, write).

**Matriks bawaan:**

- Dokter: `clinical.*` lingkup relationship/unit, order, consent sign.
- Residen: `clinical` read/write/correct tanpa cosign/sign, `order.write`, triase.
- Perawat/bidan: `clinical` read/write/correct, `medication.administer`, triase, `bed` — semuanya lingkup unit.
- Pendaftaran/admisi: `bed` lingkup all.
- RM/koder: `clinical.read` lingkup all.
- Manajemen: `bed.read`.
- Auditor mutu: `order.read` untuk laporan override CDS.

**Pengaturan baru:** `clinical.late_entry_hours` (24), `cppt.verify_hours` (24), `triage.scale` (`ATS`), `emar.scan_valid_minutes` (10), `emar.late_minutes` (60), `emar.require_pharmacy_review` (false), `ews.escalation_score` (5), `bed.boarding_alert_hours` (4).

**Konstanta:**

- Aksi audit `cosign`.
- Event domain: `encounter.started/finished`, `cppt.finalized`, `order.activated/cancelled`, `medication.administered`, `adt.admitted/transferred/discharged`, `bed.status_changed`, `discharge.signed`, `consent.signed`.
- Operasi outbox: `bpjs.aplicare.update` dan `satusehat.<resource>.upsert`.

**Mesin aturan murni dipindah dari `apps/web/src/lib` ke `packages/shared/src/clinical/`:** CDS (`evaluateCds`, basis pengetahuan sebagai data), NEWS2 (`ewsScore`/`ewsLevel`), saran triase ATS, 12 butir kelengkapan resume, status slot eMAR, singkatan terlarang. API memakainya sebagai sumber kebenaran; web untuk pratinjau dan demo.

**Revisi kontrak `schemas/klinis.ts` dan `rawat-inap.ts`:**

- ID katalog/order menjadi UUID.
- Penulis = `{userId, nama, peran}` dari server.
- Jam eMAR dinamis dari frekuensi order.
- Biaya `null` sampai U01 tersedia.
- Status `menunggu_cosign`.
- `occurredAt`/`recordedAt`.
- Skema input umum koreksi, addendum, dan salah entri.

**Tes:** unit mesin aturan (golden dari angka demo: blok sefadroksil, NEWS2, saran triase), kontrak.

### 3.0b · Skema I: pola entri klinis + catatan inti (`packages/db`), setelah 3.0a

- ADR-0028: entri klinis berversi, draf terpisah, atestasi, dua stempel waktu (memperluas ADR-0004).
- Pindah ke skema Prisma multi-berkas `prisma/schema/<domain>.prisma`.

**Tabel:**

- `clinical_drafts`: bukan rekam medis; hanya penulis yang mengubah/menghapus; dibersihkan job P11 setelah encounter selesai.
- `clinical_attestations`: append-only, `kind` cosign|verify|review_order, unik per (target, jenis, pengguna).
- `encounter_participants`: tim perawatan (DPJP utama, rawat bersama, konsultan, perawat penanggung jawab), periode tutup-sekali.
- `observations`: LOINC; kategori vital/lab/imaging/survei/cairan; flag interpretasi; skor EWS.
- `diagnostic_reports`.
- `conditions`: ICD-10 dari `ref`; utama/sekunder/komplikasi; diagnosis encounter atau problem list.
- `procedures`: ICD-9-CM.
- `allergy_intolerances`: zat terkode (`drug_substances`) atau teks; kategori; kritikalitas; reaksi; NKDA eksplisit.
- `cppt_entries`: PPA, SOAP/ADIME, instruksi, `cosign_required`.
- `handovers`: SBAR.
- `consult_requests` + `consult_responses`.
- `consents` + `consent_signatures` (ref dokumen P08).
- `discharge_summaries` + `discharge_medications` + `discharge_summary_sources`.

**Perubahan tabel lama:** `form_responses` + `encounter_id`; `form_packages` (setting RJ/IGD/RI, formulir wajib; EP 6b/7a); `documents` + `source_type`/`source_id`; `patients.confidential` (EP 10c); migrasi data izin baru ke peran RS yang sudah ada.

**Tes db:** append-only setiap tabel (juga pemilik), koreksi serentak → satu gagal unik, CHECK alasan, versi ber-TTE ditolak digantikan, RLS/isolasi tenant, schema-guard `FORCE`, `*_current`.

### 3.0c · Skema II: ADT, triase, order/CDS, eMAR, askep, staging, seed, setelah 3.0b

**ADT dan bed:**

- `bed_status` (status kini + `version`) dan `bed_status_events` (append-only). Status: siap, dipesan, terisi, pulang, kotor, dibersihkan, rusak.
- `bed_requests`: asal IGD/OK/poli, kebutuhan kelas/unit/isolasi.
- `bed_assignments`: periode `tstzrange`. **EXCLUDE (btree_gist): satu bed tidak dihuni dua encounter, satu encounter satu bed sekaligus.** `ended_at`/`end_reason` tutup-sekali.
- `patient_wristbands`: kode acak per encounter, batal tutup-sekali.
- `wristband_scans`: append-only (cocok/tidak, pengguna, waktu).

**Triase:** `triage_assessments` (berversi; saran vs pilihan; CHECK: pilihan lebih rendah dari saran wajib alasan) dan `ed_status_events`.

**Order dan CDS:**

- Master: `orderables` (LOINC/ICD-9-CM, unit tujuan, penjaminan), `drugs` (KFA nullable, sediaan, golongan, Fornas, `high_alert`) + `drug_substances`, `order_sets` + item.
- `order_groups`: satu pengiriman, Idempotency-Key unik.
- `service_requests` dan `medication_requests`: isi beku; racikan didukung.
- `order_status_events`: append-only.
- `cds_rules`: KB per RS berversi.
- `cds_alerts`: append-only; CHECK override `block` wajib alasan ≥ 10.

**eMAR:**

- `medication_schedules`.
- `medication_administrations`: append-only, `wristband_scan_id NOT NULL`. **Trigger: pindaian cocok, encounter sama, perawat sama, ≤ `emar.scan_valid_minutes`.** Indeks unik parsial: satu dosis "diberikan" per jadwal.

**Askep dan master lain:** `nursing_diagnoses` (master lokal), `nursing_care_plans` (berversi), `abbreviations` (per RS).

**Staging lintas fase:** `billable_events` (append-only, unik per sumber/id/jenis, tanpa harga); `outbox_messages.status` + `held` (tidak diklaim dispatcher).

**Fungsi:** `app_patient_location(patient)` → unit/bed kini.

**Seed:** bangsal Melati 12 kelas 2, Anggrek 8 kelas 1, Isolasi 4; bed IGD zona R/B/K; obat/orderable dari katalog demo (kode hanya dari `SEED_REF_SAMPLES`, sisanya "belum dipetakan"); 4 order set; KB CDS contoh (penisilin↔sefalosporin-1 block, sefalosporin-3 warn, glimepirid+metformin, klopidogrel+omeprazol, metformin eGFR < 30, duplikasi lab); daftar singkatan "Do Not Use"; paket formulir RJ/IGD/RI; riwayat klinis fiktif pasien demo.

**Tes db:** hunian ganda ditolak EXCLUDE; pemberian obat tanpa pindai / tidak cocok / kedaluwarsa / pengguna lain ditolak; dosis ganda ditolak; override tanpa alasan ditolak; `held` tidak diklaim; isolasi tenant.

### 3.0d · Fondasi web klinis (paralel dengan 3.0b–3.0c)

- Pecah `lib/server/data/klinis.ts` dan `rawat-inap.ts` menjadi `data/klinis/{poli,cpoe,igd,bed,ranap,resume,consent}.ts`.
- Ketujuh halaman memakai `requireScreen` hybrid (fase 2 0c); jalur demo ke `demo-*.tsx` + `actions-demo.ts`; `actions.ts` jalur api memanggil `api()`.
- Helper CDS/EWS/triase/eMAR web diganti impor dari shared; demo memakai KB contoh yang sama.
- Penyaji formulir P07 untuk klinisi (`components/forms/form-renderer.tsx`).
- **Tes:** unit web, `rsc-boundary`, seluruh E2E `e2e/demo/**` hijau.

### 3.1 · Infrastruktur API klinis, setelah 3.0c

- `ClinicalRecordService`: versi 1, koreksi (penulis asli; 409 bila sudah digantikan), salah entri, addendum oleh PPA lain, kunci TTE (`RECORD_LOCKED`), penanda terlambat. API draf `PUT/GET/DELETE /api/v1/drafts/:encounterId/:kind` (hanya penulis).
- **ADR-0029 PDF klinis + TTE (P12 minimal):** `pdf-lib` + fontkit + IBM Plex (OFL), deterministik; dokumen → `documents` → `document_signatures` pending → outbox `tte.sign`; `onDead` menandai TTE gagal.
- **ADR-0032 staging:** `SatusehatRecorder` (outbox `held`, payload ID) dan `BillableRecorder`, di transaksi yang sama.
- **ADR-0031 ABAC:** lingkup `unit` = `app_patient_location`; relasi dari `encounter_participants` disinkron ke `access_relationships`; break-the-glass tetap; temuan audit "akses pasien rahasia".
- Kanal SSE klinis (papan IGD, papan bed, eskalasi EWS); kerangka modul (`worklist`, `encounter`, `triage`, `adt`, `assessment`, `cppt`, `diagnosis`, `orders`, `cds`, `consult`, `consent`, `nursing`, `discharge`, `summary`, `care-packages`, `results`) didaftarkan sekali; global-setup E2E akun DPJP/residen/perawat/admisi + pasien beralergi.
- **Tes:** koreksi serentak [201, 409]; field penulis di body ditolak; ABAC unit (perawat Melati → pasien Anggrek 403 + audit; transfer memindah akses); PDF hash sama untuk input sama; TTE DLQ terlihat.

### 3.2a · Data klinis terkode, TTV/EWS, hasil, ringkasan (K08, K12-observasi, K14)

- `POST/GET /api/v1/encounters/:id/observations`: NEWS2 dihitung server; eskalasi (≥ 5 atau satu parameter 3) → notifikasi P09 tanpa PHI + SSE.
- `GET /api/v1/encounters/:id/context` (banner).
- Diagnosis: `POST /api/v1/diagnosis/conditions` (ICD-10 dari `ref`, satu utama per encounter), koreksi/salah entri, `POST /api/v1/diagnosis/procedures` (ICD-9-CM), `GET /api/v1/diagnosis/problem-list?patientId=` (kelompok RM), `POST /api/v1/diagnosis/allergies` (+ NKDA; perubahan = versi baru).
- `POST /api/v1/results/observations` (`result.write`) dan `GET /api/v1/results?patientId=`.
- `GET /api/v1/summary/patients/:id` (K14).
- Audit `read` per pasien, `create`/`correct` dengan `patientId`. Staging SATUSEHAT `held` (Observation, Condition, Procedure, AllergyIntolerance) dan `billable_events` prosedur.
- **Tes:** 403 per peran, tenant lain 404, koreksi diagnosis berversi, satu diagnosis utama. **DoD:** entri immutable; sumber resume.

### 3.2b · CPPT, co-sign, verifikasi DPJP, serah terima, asesmen, worklist (K07, K06, K01)

- `POST /api/v1/cppt/entries` (peran dari sesi; residen → `menunggu_cosign`); koreksi/addendum/salah entri; `POST .../:id/cosign` (hanya DPJP/rawat bersama; residen 403; bukan entri sendiri); `POST .../:id/verify`; `GET /api/v1/cppt/entries`.
- `POST /api/v1/cppt/handovers` (SBAR). Asesmen K06 lewat `/api/v1/forms/responses` + `encounterId` (hak tulis per profesi, ADR-0019).
- `GET /api/v1/worklist?view=dpjp|unit|shift|tugas` (co-sign, verifikasi > 24 jam, review order residen, TTE gagal, EWS tinggi, resume lewat batas).
- Peringatan singkatan terlarang (warn). `billable_events` visite DPJP.
- **Tes:** residen tidak memfinalkan; co-sign serentak sekali; koreksi hanya penulis; addendum atas final; izin unit + isolasi. **DoD:** co-sign residen.

### 3.3 · ADT, papan bed, triase IGD, gelang, Aplicare (K03, K04, K05)

- Triase: `POST /api/v1/triage/assessments` (saran ATS server; turun tanpa alasan → 422 `TRIAGE_REASON_REQUIRED`), `GET /api/v1/triage/board` + SSE, `POST /api/v1/encounters/:id/ed-status` (rute per-kunjungan kanonik).
- ADT: papan bed + SSE; `PATCH /api/v1/adt/beds/:id/status` (`baseVersion`); permintaan bed + alokasi (bed → `dipesan`); `POST /api/v1/adt/admissions` (IGD → encounter IMP `part_of`, atau dari encounter `planned`/SPRI; gelang terbit); transfer; `POST /api/v1/adt/discharges` (memanggil `DischargeGate`); cetak ulang gelang beralasan.
- Outbox `bpjs.aplicare.update` (digabung); mock Aplicare dimiliki potongan ini.
- Staging `billable_events` admit/transfer/pulang/IGD; SATUSEHAT `held` Encounter.
- **Tes:** alokasi ganda, hunian ganda, lingkup unit pindah setelah transfer, boarding > 4 jam, worker Aplicare, SSE tanpa bocor antar-tenant.

### 3.4 · CPOE + CDS + resep (K09)

- `GET /api/v1/orders/catalog?q=`; order set `GET/POST /api/v1/orders/order-sets`.
- `POST /api/v1/orders/evaluate` (pratinjau; alergi + reaksi silang, interaksi, duplikasi kelompok RM, dosis ginjal + berat badan, singkatan terlarang); `GET /api/v1/cds/overrides`; ADR-0030 CDS deklaratif dengan KB per RS.
- `POST /api/v1/orders/submit` (Idempotency-Key; evaluasi ulang server; `block` tanpa override beralasan → 422 `CDS_BLOCKED`; semua di `cds_alerts`; order residen → tinjau DPJP; resep → PDF + TTE asinkron). `POST /api/v1/orders/:id/cancel` (alasan).
- Staging `billable_events` lab/rad/tindakan; SATUSEHAT `held` ServiceRequest, MedicationRequest.
- **Tes:** amoksisilin alergi + sefadroksil → 422, dengan alasan → 201 + `cds_alerts` overridden + audit; kirim ganda idempoten; KB per tenant; order residen → tugas DPJP. **DoD:** resep berlergi diblokir.

### 3.5 · eMAR + asuhan keperawatan (K12), setelah 3.3 dan 3.4

- Jadwal dari order obat aktif (frekuensi → jam WIB; PRN; stat). Tanpa gerbang telaah farmasi di fase 3.
- `POST /api/v1/nursing/wristband-scans` (tidak cocok → tercatat + 422 `WRISTBAND_MISMATCH`); `POST /api/v1/nursing/administrations` (wajib `scanId`; terlambat/ditunda/ditolak wajib alasan; `high_alert` wajib atestasi perawat kedua); `GET /api/v1/nursing/emar/:encounterId`.
- `POST /api/v1/nursing/care-plans`; balans cairan sebagai `observations`.
- Staging SATUSEHAT `held` MedicationAdministration; `billable_events` pemberian obat.
- **Tes:** tanpa pindai / kedaluwarsa / pengguna lain ditolak (API + DB), dosis ganda, terlambat tanpa alasan, cek ganda high-alert. **DoD:** gelang.

### 3.6 · Resume, rekonsiliasi obat, pulang, gerbang tutup encounter (K13, EP 5c)

- `POST /api/v1/discharge/summaries`: draf dihimpun dari sumber (asesmen awal, observasi, hasil, kondisi, prosedur, eMAR, edukasi, surat kontrol), tiap bagian membawa ref sumber.
- Rekonsiliasi (baru, lanjut, ubah dosis, dihentikan; dikonfirmasi DPJP).
- `POST .../:id/finalize` (`clinical.sign`): 12 butir diperiksa server → PDF + TTE → terkunci; addendum setelah final. Resume RJ ringkas untuk penutupan poli (memicu task 5).
- `DischargeGate`: RI = disposisi + resume final; meninggal = surat kematian; rujuk = surat rujukan (F07); surat kontrol BPJS lewat fase 2.
- **K-1 (keputusan pemilik produk 7 Okt 2026, `docs/13-pembagian-tugas-cd-cx.md` §8):** disposisi `meninggal` hanya bisa diselesaikan dokter yang berelasi dengan pasien (DPJP, rawat bersama, atau dokter jaga yang punya akses); wajib jam kematian, sebab kematian ICD-10, dan surat keterangan kematian ber-TTE (`clinical.sign`); admisi (`bed.write` tanpa relasi) ditolak. `DischargeGate` menegakkan aturan ini.
- Staging SATUSEHAT `held` Composition dan Encounter `finished`.
- **Tes:** menggantikan resume ber-TTE → 409 `RECORD_LOCKED` (addendum boleh); tutup tanpa resume → 409; isi resume = data sumber. **DoD:** resume.

### 3.7 · Persetujuan tindakan tablet + edukasi (K11)

- Templat consent di P07 (7 butir informasi wajib); draf; tanda tangan pasien/wali + saksi (PNG via unggahan biner ADR-0020 atau ketik nama), atestasi saksi petugas; finalize (`consent.sign`) → PDF bertanda tangan → TTE; penolakan beralasan ≥ 10 → dokumen penolakan + TTE; pencabutan = versi baru. Edukasi lewat P07.
- **Tes:** finalize tanpa dua tanda tangan → 422; consent final tidak bisa diubah; isolasi/ABAC.

### 3.8 · Konsultasi/rawat bersama, paket formulir + kelengkapan, dokumen pasien (K10, K15, utang P08)

- Konsultasi (permintaan + jawaban terstruktur); ganti DPJP utama = versi baru (relasi akses ikut).
- `GET /api/v1/care-packages?setting=`, `GET /api/v1/assessment/encounters/:id/completeness` (EP 6b/7a).
- `components/klinis/patient-documents.tsx` (daftar/unggah/batal/minta TTE lewat P08).
- **Tes:** konsultan dapat akses berbatas waktu; kelengkapan per setting.

### W1 · Layar Poli, setelah 3.2a, 3.2b, 3.4, 3.6

Berkas `app/(staf)/klinis/poli/*`, `components/klinis/{poli-*,patient-header,vitals-card,nurse-vitals-form,soap-*,visit-panels,status-flag}.tsx`. Antrean dari `queue` fase 2 (panggil → task 4), banner, TTV, SOAP autosave draf → final, ICD-10, rencana, riwayat; "Tanda tangani dan selesai" → resume RJ TTE + surat kontrol + task 5. Tes: unit hook, E2E api.

### W2 · Layar CPOE, setelah 3.4

Berkas `app/(staf)/klinis/order/*`, `components/klinis/cpoe-*`. Katalog, order set, pratinjau CDS server, dialog override beralasan, kirim, status TTE resep, batal; nominal disembunyikan di mode api. Tes: E2E alergi diblokir lalu override.

### W3 · Layar IGD + Tempat tidur, setelah 3.3

Berkas `app/(staf)/klinis/{igd,tempat-tidur}/*`, `components/rawat-inap/{triage-badge,triage-level-picker}.tsx`. Papan SSE, triase beralasan, permintaan → alokasi → admit, status bed bertulisan, cetak gelang. Tes: E2E triase dan alokasi.

### W4 · Layar Rawat inap, setelah 3.2b, 3.5, 3.8

Berkas `app/(staf)/klinis/rawat-inap/*`. Tab Ringkasan, CPPT & eMAR (gelang lalu dosis satu per satu, co-sign, koreksi, addendum, SBAR), Observasi & EWS, Askep, Hasil, Dokumen. Tes: E2E gelang + co-sign.

### W5a · Tablet Persetujuan, setelah 3.7

Berkas `app/(perangkat)/tablet/persetujuan/*`, `components/rawat-inap/signature-*`. Sesi staf di tablet. Tes: E2E dua tanda tangan → TTE; penolakan beralasan.

### W5b · Layar Resume, setelah 3.6

Berkas `app/(staf)/klinis/resume/*`. Bagian berlabel sumber, rekonsiliasi, 12 butir, TTE, addendum, cetak. Tes: E2E resume terkunci.

### 3.9 · Penutup fase 3

- **E2E api rawat jalan:** poli panggil → TTV → SOAP + ICD-10 → CPOE alergi diblokir → override beralasan → selesai → resume RJ ber-TTE terkunci.
- **E2E api IGD → ranap:** triase (turun wajib alasan) → permintaan bed → admit + gelang → CPPT residen → co-sign DPJP → eMAR (tanpa pindai ditolak, pindai → diberikan) → resume TTE → pulang → bed kotor → Aplicare di mock.
- Verifikasi `held` SATUSEHAT dan `billable_events`.
- `/review-keamanan`, ADR 0028–0032, panduan, PROGRESS, QA visual, regresi E2E demo.

## 3. Paralelisasi (maks. 5 agen sekaligus)

- **Gelombang 0:** 3.0a.
- **Gelombang A:** 3.0b → 3.0c (satu agen DB, berurutan) ∥ 3.0d.
- **Gelombang B:** 3.1 ∥ sisa 3.0d.
- **Gelombang C:** 3.2a ∥ 3.2b ∥ 3.3 ∥ 3.4 ∥ 3.7.
- **Gelombang D:** 3.5 ∥ 3.8 ∥ W2 ∥ W3 ∥ W5a.
- **Gelombang E:** 3.6 ∥ W4.
- **Gelombang F:** W1 ∥ W5b, lalu 3.9.

| Berkas / area                                                    | Pemilik                                                                  |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Registri shared (izin, pengaturan, event, nama operasi, kontrak) | 3.0a saja                                                                |
| Skema Prisma + migrasi besar                                     | 3.0b/3.0c saja; perbaikan sesudahnya memakai blok cap waktu per potongan |
| `app.module.ts`                                                  | 3.1 saja                                                                 |
| Folder modul API                                                 | satu potongan per folder                                                 |
| Mock Aplicare                                                    | 3.3                                                                      |
| `operations.ts` worker                                           | satu baris per operasi                                                   |
| `lib/server/data/klinis/*`                                       | dipecah 3.0d per layar                                                   |
| `patient-header.tsx`                                             | W1                                                                       |
| Folder rute web                                                  | satu W per folder                                                        |
| PROGRESS                                                         | hanya agen penggabung                                                    |

## 4. Keputusan (semua diambil, disetujui otomatis 5 Okt 2026)

1. **Draf klinis** di `clinical_drafts`: bukan rekam medis, boleh diubah/dihapus penulis, dibersihkan P11. Entri final selalu append-only.
2. **Jenis tanda tangan:** CPPT, SOAP, order, eMAR = atestasi elektronik sesi; TTE tersertifikasi hanya dokumen legal (resume RJ/RI, persetujuan/penolakan, resep).
3. **PDF server** `pdf-lib` + fontkit + IBM Plex (ADR-0029). Tiket dan gelang tetap HTML.
4. **Residen:** CPPT `menunggu_cosign` sampai DPJP co-sign. Order residen langsung aktif tetapi wajib ditinjau DPJP di worklist.
5. **Verifikasi DPJP** atas CPPT PPA lain dalam 24 jam: worklist + temuan, tidak memblokir.
6. **Triase** ATS 5 level (target 0/10/30/60/120 menit); saran berbasis aturan TTV + keluhan; turun level wajib alasan ≥ 10, naik bebas.
7. **IGD → rawat inap** = encounter IMP baru (`part_of` IGD); encounter IGD selesai dengan disposisi rawat inap.
8. **Gelang:** kode acak per encounter; cetak ulang membatalkan yang lama; tidak ada jalur melewati pindai; pindaian berlaku 10 menit untuk perawat yang sama.
9. **eMAR tanpa gerbang telaah farmasi** di fase 3 (fase 4 menyalakan `emar.require_pharmacy_review`); high-alert wajib cek ganda.
10. **Basis pengetahuan CDS** per RS, dikelola komite farmasi/PFT, impor CLI gagal-tertutup; seed hanya contoh; override `block` wajib alasan ≥ 10 + laporan tinjauan.
11. **EWS:** NEWS2 dewasa dihitung server; PEWS/MEOWS sebagai formulir berskor P07; eskalasi tanpa PHI.
12. **Muara hasil penunjang:** `observations` + `diagnostic_reports`; fase 4 menulis ke sini setelah validasi.
13. **SATUSEHAT** = outbox `held` (payload ID); fase 7 melepasnya berurutan, Encounter dulu (ADR-0032).
14. **Biaya** di `billable_events` tanpa harga, idempoten; fase 5 memberi harga; CPOE mode api tanpa nominal sampai U01.
15. **Diagnosa keperawatan** master lokal tanpa kode resmi; SDKI/SLKI/SIKI diimpor bila tersedia.
16. **Singkatan terlarang:** daftar baku per RS, peringatan (tidak memblokir) (EP 9a).
17. **Racikan:** struktur data sekarang; antarmuka bersama farmasi fase 4.
18. **K15:** hanya mekanisme paket formulir per setting + kelengkapan.
19. **Tutup encounter RI:** disposisi + resume final dengan TTE diminta; TTE gagal masuk worklist.
20. **Tablet persetujuan** memakai sesi staf; tanpa prinsipal perangkat.
21. **Pasien rahasia (EP 10c):** flag + temuan audit; pengetatan akses di B09 fase 8.
22. **Disposisi meninggal (K-1, diputuskan pemilik produk 7 Okt 2026):** hanya dokter yang berelasi dengan pasien; jam kematian + sebab kematian ICD-10 + surat keterangan kematian ber-TTE wajib; admisi ditolak; ditegakkan `DischargeGate` (3.6).

## 5. Risiko dan utang teknis

- **Kebenaran klinis aturan:** CDS, saran triase, NEWS2 butuh validasi komite medik/PFT sebelum pilot.
- **Data rujukan:** 72 kode contoh; obat tanpa KFA "belum dipetakan"; dataset resmi wajib diimpor.
- **Kontrak demo:** jam eMAR tetap, ID slug, penulis string — direvisi di 3.0a.
- **`btree_gist`:** perlu `CREATE EXTENSION`; periksa di Postgres portabel dan Docker.
- **Performa:** view `_current` + RLS + kelompok RM; indeks `(tenant_id, root_id, version)` dan `(tenant_id, encounter_id)`.
- **Volume** `held` SATUSEHAT dan `billable_events` sampai fase 5/7.
- **PDF/TTE:** deterministik, font tertanam, TTE gagal via `onDead`; kebijakan tanda tangan basah RS terbuka (docs/03).
- **Konkurensi:** co-sign/dosis/alokasi/koreksi ganda dijaga UNIQUE/EXCLUDE + tes.
- **Waktu:** jadwal eMAR dan batas hari WIB vs DB UTC (ADR-0014).
- **Draf berisi PHI:** pembersihan berjadwal; enkripsi at-rest di fase 10.
- **Ketergantungan fase 4:** worklist penunjang mengonsumsi `service_requests`; hasil masuk `observations`.
- **Utang yang ditutup:** P03 lingkup unit tingkat bed; P07 layar isian klinisi + flag skor; P08 layar dokumen + TTE DLQ; P05 riwayat via kelompok RM.
- **Utang tetap:** downtime/entri susulan (fase 10); B10 pendidikan klinis; seed bed belum 186; konsistensi roster demo.

## 6. Definisi selesai fase 3 → potongan

| Kriteria                                                                                                                  | Potongan                                   |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Entri klinis final tidak bisa diubah; koreksi berversi                                                                    | 3.0b, 3.0c, 3.1, 3.2a, 3.2b, 3.6, 3.7, 3.9 |
| Resep dengan alergi terdaftar diblokir; override butuh alasan dan tercatat                                                | 3.0a, 3.0c, 3.2a, 3.4, W2, 3.9             |
| Pemberian obat tidak bisa dicatat sebelum gelang terverifikasi                                                            | 3.0c, 3.3, 3.5, W4, 3.9                    |
| Resume menarik diagnosis, tindakan, hasil, obat tanpa input ulang; terkunci setelah TTE                                   | 3.1, 3.2a, 3.4, 3.5, 3.6, W5b, 3.9         |
| Residen tidak bisa memfinalkan CPPT tanpa co-sign DPJP                                                                    | 3.0b, 3.2b, W4, 3.9                        |
| Aturan umum (migrasi + seed, tes izin + isolasi + ABAC, audit, teks Indonesia, lint/typecheck/test hijau, E2E demo hijau) | setiap potongan; diperiksa di 3.9          |
