# Rencana fase 8 · Back office dan tata kelola (B01–B13)

Disusun 5 Okt 2026 oleh agen R. Tidak ada keputusan yang menunggu jawaban. Setiap pilihan di §4 memakai opsi yang paling baku, aman, dan sederhana **(keputusan diambil, disetujui otomatis 5 Okt 2026)**.

**Nomor ADR:** dicadangkan 0060–0064 untuk fase 8, 0065–0069 untuk fase 9, dan 0070–0075 untuk fase 10. Nomor 0028–0059 dibiarkan untuk fase 3–7. Agen penggabung menomori ulang secara berurutan bila ada yang bentrok.

## 1. Ringkasan

Fase 8 membangun backend nyata untuk empat komponen prioritas. Kolom "Fungsi" menjelaskan isi tiap komponen.

| Komponen                 | Fungsi                                                                                                                                                                                                                  |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B01 supply chain         | Master item generik (obat, BHP, alkes, non-medis, dapur), kebijakan stok dan ABC-VEN, ROP → usulan PO, persetujuan, PO, penerimaan barang (stok + hutang + jurnal), retur, kedaluwarsa/FEFO, stok opname                |
| B03 SDM inti             | Pegawai, jabatan, jadwal dinas, cuti, presensi dasar. Pegawai keluar → akun dan penugasan berakhir otomatis (MRMIK 2.1b)                                                                                                |
| B06 mutu dan keselamatan | Mesin indikator: 13 INM + IMP-RS dari data transaksi. IKP + investigasi. Register risiko                                                                                                                                |
| B09 RM administratif     | Pelepasan informasi dan hak subjek data (UU PDP), log akses per pasien, penanda pasien rahasia/karyawan, peminjaman berkas lama, retensi + pemusnahan berjejak, kelengkapan RM + audit sampling, laporan koreksi/koding |

Komponen berikut dibangun sebagai **struktur dasar** dan bisa dimatikan per tenant:

- B02 aset
- B04 kredensial, ditegakkan di CPOE
- B05 penggajian
- B07 PPI
- B08 PPRA
- B10 pendidikan klinik
- B11 onkologi
- B12 dokumen regulasi (DMS)
- B13 pengaduan + survei kepuasan

**Layar:**

- **Logistik dan Mutu & keselamatan:** dipindah dari `demo` ke `api`. Jalur demo tetap hidup dan diuji E2E demo.
- **Layar baru sederhana** (gaya sama, status `api`): RM administratif, SDM, PPI, Dokumen regulasi, Pengaduan, Lapor insiden, dan halaman survei publik bertoken.

**Urutan pengerjaan:**

1. Kontrak bersama, lalu skema DB (berurutan).
2. Fondasi web hibrida.
3. Empat domain prioritas dikerjakan paralel.
4. Struktur dasar komponen lain.
5. Layar.
6. Penutup: E2E DoD.

**Prasyarat:**

- DoD fase 2–7 hijau, atau pengecualian dicatat di PROGRESS.
- Fondasi fase 2 sudah ada: 1a (P11 job per tenant, `defer`/`onDead`), 1b (publisher event domain), 0c (`requireScreen`, pemisahan `demo-*.tsx`).

**Antarmuka yang dibutuhkan dari fase lain** (perencana fase 3–7 diminta menyediakannya):

| Fase | Antarmuka                                                                                                                                                                                                                                                                                                                       | Dipakai di                              |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| 2    | Waktu `queue_tickets`/`queue_calls` dan task BPJS 3→4 (indikator waktu tunggu RJ)                                                                                                                                                                                                                                               | 8.4a                                    |
| 2    | Operasi pesan WhatsApp pasien lewat outbox (keputusan fase 2 no. 8)                                                                                                                                                                                                                                                             | 8.7                                     |
| 2    | Tabel `practitioners`                                                                                                                                                                                                                                                                                                           | 8.2                                     |
| 2    | P11 dan publisher event                                                                                                                                                                                                                                                                                                         | semua                                   |
| 3    | Event `encounter.finished` / `encounter.discharged`                                                                                                                                                                                                                                                                             | 8.7 survei                              |
| 3    | `bed_assignments` (hari rawat)                                                                                                                                                                                                                                                                                                  | 8.5 PPI/PPRA                            |
| 3    | Entri klinis membawa `occurred_at` + `recorded_at` + penanda entri susulan                                                                                                                                                                                                                                                      | 8.6b laporan entri terlambat (MRMIK 8d) |
| 3    | Pindai gelang eMAR (INM-03), CPPT DPJP dengan jam (INM-07), `signed_at` resume (IMP-RS), asesmen Morse + intervensi (INM-11)                                                                                                                                                                                                    | 8.4a                                    |
| 3    | Daftar dokumen wajib per setting + status kelengkapan per kunjungan                                                                                                                                                                                                                                                             | 8.6b                                    |
| 3    | **Kait `OrderGuard` di CPOE** yang bisa memblokir (dengan alasan override) atau menahan order `pending_approval`                                                                                                                                                                                                                | 8.3 B04, 8.5 B08                        |
| 3    | Generator PDF P12 dengan watermark teks per halaman                                                                                                                                                                                                                                                                             | 8.6a                                    |
| 4    | **Satu buku stok** di modul `supply-chain`: `items` generik ber-`kind`, `stock_locations`, `stock_batches` (CHECK qty ≥ 0), `stock_movements` append-only, `postStockMovement()`, pemilih FEFO. S05 memakai buku ini, tidak memilikinya. Bila fase 4 menamai tabel berbeda, 8.0b menyesuaikan; tidak boleh ada buku stok kedua. | 8.1a/b                                  |
| 4    | Resep ber-penanda Fornas (INM-09)                                                                                                                                                                                                                                                                                               | 8.4a                                    |
| 4    | S09 waktu validasi → lapor (INM-08)                                                                                                                                                                                                                                                                                             | 8.4a                                    |
| 4    | S06 waktu keputusan / jadwal / insisi / alasan tunda (INM-04, INM-06)                                                                                                                                                                                                                                                           | 8.4a                                    |
| 4    | Dispensing per item (DDD) dan hasil mikro (HAI, antibiogram)                                                                                                                                                                                                                                                                    | 8.5                                     |
| 5    | `AccountingService.postJournal()`: wajib seimbang, menolak periode tertutup                                                                                                                                                                                                                                                     | 8.1b, 8.3                               |
| 5    | Pemetaan COA: `inventory.<kind>`, `ap.trade`, `inventory.variance`, `payroll.*`                                                                                                                                                                                                                                                 | 8.1b, 8.3                               |
| 5    | `PayablesService.createFromGoodsReceipt()` (idempoten per GR) + nota debit retur                                                                                                                                                                                                                                                | 8.1b                                    |
| 5    | U08 total jasa pelayanan per praktisi per periode                                                                                                                                                                                                                                                                               | 8.3 B05                                 |
| 5    | Kode ICD `.9` / kosong dari U06                                                                                                                                                                                                                                                                                                 | 8.6b laporan 9b                         |
| 7    | `lib/server/data/integrasi.ts` milik fase 7 (fase 8 tidak menyentuhnya)                                                                                                                                                                                                                                                         | 8.0c                                    |

## 2. Potongan kerja (urut dependensi)

### 8.0a · Kontrak bersama (`packages/shared`)

**Katalog izin (`authz.ts`):**

| Sumber                    | Aksi                            |
| ------------------------- | ------------------------------- |
| `inventory`               | read, write, receive, opname    |
| `procurement`             | read, propose, approve          |
| `hr`                      | read, write                     |
| `hr.roster`               | read, write                     |
| `credential`              | read, write, verify             |
| `payroll`                 | read, write, approve            |
| `asset`                   | read, write                     |
| `quality`                 | read, write, manage             |
| `incident`                | report, read, investigate       |
| `risk`                    | read, write                     |
| `ipc`                     | read, write                     |
| `ams`                     | read, approve                   |
| `education`               | read, write                     |
| `oncology`                | read, write, verify             |
| `regdoc`                  | read, write, approve            |
| `complaint`               | read, write                     |
| `survey`                  | read, manage                    |
| `record.release`          | read, write, approve            |
| `record.loan`             | read, write                     |
| `record.retention`        | read, propose, approve, execute |
| `record.review`           | read, write                     |
| `patient.confidentiality` | write                           |

**Peran sistem baru** (ADR-0063): `petugas_logistik`, `petugas_sdm`, `komite_medik`, `komite_ppi`, `tim_ppra`.

**Matriks bawaan (ringkas):**

- Semua peran: `incident.report`, `regdoc.read`.
- `manajemen`: `procurement.approve`, `record.retention.approve`, `payroll.approve`, `regdoc.approve`.
- `apoteker`: `inventory` lingkup unit gudang farmasi.
- `auditor_mutu`: `quality.*`, `incident.read/investigate`, `risk.*`, `record.review.*`.
- `petugas_rm`: `record.release.read/write`, `record.loan.*`, `record.retention.read/propose/execute`.
- `petugas_privasi`: `record.release.approve`, `patient.confidentiality.write`.
- `petugas_pendaftaran`: `complaint.write`.

**Pengaturan (kunci P12):**

- `supply.reorder_scan_time` (06:00), `supply.expiry_alert_days` (90), `supply.min_expiry_months` (6), `supply.abc_thresholds` ({a: 80, b: 95})
- `quality.compute_time` (01:30)
- `incident.simple_days` (7), `incident.rca_days` (45)
- `roi.response_hours` (72), `record.loan_days` (3), `retention.default_years` (25)
- `complaint.sla_hours` ({merah: 24, kuning: 72, hijau: 168})
- `survey.delay_hours` (2), `survey.expiry_days` (7)
- `credential.expiry_warning_days` (60)

**Penomoran:** `po` (`PO-2610-031`), `goods_receipt` (`GR-2610-0001`), `opname`, `ikp` (`IKP-2610-001`), `roi`, `destruction` (`BAP-2026-001`), `complaint` (`ADU-…`), `asset`, `payroll_run`, `regdoc` (per jenis).

**Event domain:** `supply.po_approved`, `supply.goods_received`, `hr.employee_terminated`, `hr.leave_approved`, `credential.expiring`, `incident.reported`, `incident.sentinel`, `record.release_completed`, `complaint.received`.

**`QUALITY_INDICATOR_CATALOG`:**

- 13 INM + IMP-RS: resume ≤ 1×24 jam, pelaporan IKP ≤ 2×24 jam, plus dua lainnya dari fixture.
- Isi per indikator: kunci kalkulator, teks pembilang/penyebut, sasaran bawaan INM (konfirmasi komite mutu).

**Revisi `schemas/manajemen.ts`:**

- `id` item/alert menjadi UUID. Nomor dokumen (`number`) dipisah dari `id` (PO, IKP).
- Indikator ditambah `code`, `numerator`, `denominator`, `source: auto|manual|unavailable`.
- Skema baru: PO detail, GR, opname, kebijakan item, pegawai/jadwal, ROI, retensi, DMS, pengaduan, survei publik.
- Fixture demo divalidasi ulang terhadap skema ini.

**Modul:** B01/B03/B09 bawaan aktif (MVP). Lainnya mati (`defaultModuleEnabled`). B06/B07/B13 dinyalakan di seed tenant pilot.

**Tes:**

- Matriks tidak memberi hak tulis lintas domain.
- Kunci kalkulator unik.
- Fixture lolos skema.

### 8.0b · Skema DB + migrasi + seed (`packages/db`), setelah 8.0a

**Aturan untuk semua tabel:**

- `tenant_id` + RLS `FORCE`.
- FK komposit `(tenant_id, id)`, dibungkus `NO FORCE`/`FORCE`.
- Tanpa DELETE (hak dicabut dari `simrs_app`).
- Tabel riwayat status append-only lewat trigger.
- Uang `bigint` dengan CHECK ≥ 0.
- Dokumen yang sudah terbit/posting beku lewat trigger.
- Blok cap waktu migrasi per potongan.

**Tabel per komponen:**

| Komponen | Tabel dan aturan                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B01      | Kolom `items` diperluas: `kind`, `kfa_code` null, `high_alert`, `fornas`, `cold_chain`, `avg_cost bigint`. `item_stock_policies` (item × lokasi: lead time, safety stock, ROP, ABC, VEN, pemakaian harian). `suppliers`. `supplier_prices` (riwayat append-only). `purchase_orders` + `purchase_order_lines` (beku setelah `approved`) + `purchase_order_status_history`. `goods_receipts` + `goods_receipt_lines` (beku setelah `posted`; satu posting per GR: UNIQUE). `supplier_returns` + lines. `stock_opnames` + lines (snapshot + `counted_at`). |
| B02      | `assets`, `asset_maintenance_plans`, `asset_work_orders`, `asset_calibrations`                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| B03      | `employees`: NIK terenkripsi (tujuan `employee_nik`) + hash; FK opsional ke `users`/`practitioners`. `positions`. `employment_events` (append-only). `shift_definitions`. `duty_rosters` (berversi saat terbit). `leave_requests`. `attendance_records`.                                                                                                                                                                                                                                                                                                |
| B04      | `practitioner_licenses` (STR/SIP, berversi). `privilege_catalog`. `clinical_privileges` (status append-only).                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| B05      | `payroll_components`, `employee_pay_components`, `payroll_runs`, `payroll_lines`                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| B06      | `quality_indicator_definitions`. `quality_indicator_results` (append-only, `supersedes_id`) + view `quality_indicator_results_current`. `incident_reports` (beku setelah dikirim; addendum) + `incident_status_history` + `incident_investigations` + `incident_actions`. `risk_register_entries` + `risk_assessments` (append-only).                                                                                                                                                                                                                   |
| B07      | `ipc_hand_hygiene_audits` + observations, `ipc_ppe_audits`, `ipc_device_days`, `ipc_hai_cases`                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| B08      | `antimicrobial_restrictions`, `antimicrobial_approval_requests`. Nilai DDD di `ref.atc_ddd` (global, diimpor operator, tanpa nilai karangan).                                                                                                                                                                                                                                                                                                                                                                                                           |
| B09      | `release_of_information_requests` + status history + `roi_deliveries`. `patient_confidentiality_flags`. `physical_record_files`. `record_loans`. `retention_policies`. `retention_holds`. `destruction_batches` + items. `record_completeness_checks`. `record_review_runs` + `record_review_samples`.                                                                                                                                                                                                                                                  |
| B10      | `trainees`, `trainee_rotations`, `trainee_logbook_entries`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| B11      | `chemo_regimens`, `chemo_plans`, `chemo_cycle_orders` (verifikasi ganda: dua pelaku berbeda, CHECK)                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| B12      | `reg_documents`, `reg_document_versions` (terbit beku; usang tetap tersimpan), `reg_document_distributions`, `reg_document_reads`                                                                                                                                                                                                                                                                                                                                                                                                                       |
| B13      | `complaints` (kontak terenkripsi) + `complaint_actions`. `survey_invitations` (hanya hash token; sekali pakai). `survey_responses` (anonim terhadap laporan).                                                                                                                                                                                                                                                                                                                                                                                           |

**Migrasi data izin:** izin baru masuk ke peran RS yang sudah ada (utang P03). Peran baru dibuat lewat `ensureSystemRoles`.

**Seed (fiktif):**

- Lokasi: gudang farmasi, depo IGD/ranap/OK, gudang umum, dapur.
- 12 item mockup Logistik (KFA dari seed atau null) + pemasok generik + kebijakan stok.
- Pegawai untuk akun presentasi + jadwal dinas minggu demo.
- Definisi indikator, RR-01…, kebijakan retensi bawaan (catatan "konfirmasi regulasi RS"), templat DMS.
- Formulir survei kepuasan dan audit RM di P07.

**Tes db:**

- `schema-guard` (FORCE di semua tabel baru), RLS, CHECK.
- Append-only juga bagi pemilik tabel.
- Baris PO dan GR posted beku.
- 20 posting GR serentak → tepat 1.
- Stok tidak pernah negatif.

### 8.0c · Fondasi web hibrida layar manajemen (paralel dengan 8.0b)

- **Data layer:** `apps/web/src/lib/server/data/manajemen.ts` dipecah menjadi `logistik.ts`, `mutu.ts`, `aplikasi-pratinjau.ts`. Integrasi tetap milik fase 7.
- **Fixture:** `apps/web/src/lib/demo/fixtures/manajemen.ts` memakai UUID konstan untuk item/alert/IKP.
- **Halaman:** `app/(staf)/manajemen/{logistik,mutu}/page.tsx` → `requireScreen` + `demo-logistik.tsx`/`api-logistik.tsx` (sama untuk mutu).
- **Registri:** `lib/screens.ts` + `nav.ts` mendaftarkan layar baru berstatus `api` dengan izin nyata.
- **Tes:** E2E demo `e2e/demo/manajemen.spec.ts` tetap hijau.

### 8.1a · B01 master item, kebijakan stok, ABC-VEN, ROP → usulan PO

**Endpoint** (`/api/v1/supply`; tulis `@Audited`):

| Endpoint                                                          | Izin                  |
| ----------------------------------------------------------------- | --------------------- |
| `GET /supply/overview` (KPI = kontrak `logisticsOverviewSchema`)  | `inventory.read`      |
| `GET/POST/PATCH /supply/items`                                    | `inventory.write`     |
| `PUT /supply/items/:id/policies/:locationId`                      | `inventory.write`     |
| `GET/POST /supply/suppliers`, `POST /supply/suppliers/:id/prices` | `procurement.propose` |
| `POST /supply/reorder/scan` (pemicu manual)                       | `procurement.propose` |

**Rumus:**

- ROP = ⌈pemakaian harian 90 hari × lead time + stok pengaman⌉.
- Posisi stok = saldo + sedang dipesan.
- ABC = Pareto nilai pemakaian 12 bulan (80/95).
- VEN = keputusan komite (manual).

**Job P11:**

- `supply.consumption_stats` setiap malam.
- `supply.abc_classify` bulanan.
- `supply.reorder_scan` 06.00 WIB: membuat usulan PO berstatus `proposed` dengan `source = rop`, dikelompokkan per pemasok/kanal. Idempoten per item per hari (advisory lock tenant). Item yang sudah punya PO terbuka tidak diusulkan ulang.

**Outbox/notifikasi:** in-app "Usulan PO menunggu persetujuan" (P09, tanpa PHI).

**Tes:**

- Golden mockup: enoksaparin stok 46 < ROP 120 → masuk usulan.
- Pareto ABC.
- Scan serentak → satu usulan.
- On-order mencegah usulan ganda.
- 403 dan isolasi tenant.

**DoD:** ROP menghasilkan usulan PO.

### 8.1b · B01 pengadaan, penerimaan, retur, kedaluwarsa, opname (setelah 8.1a)

**Mesin status PO:**

- `proposed → submitted → approved → ordered → partially_received → received → closed`, dengan cabang `rejected | cancelled` (alasan wajib).
- **Pemisahan tugas:** penyetuju ≠ pengusul (`SOD_VIOLATION` 403).
- Harga dihitung ulang server dari `supplier_prices`.
- Kanal e-katalog: nomor paket diisi manual.

**Penerimaan barang (GR):**

- Dari PO, boleh parsial.
- Cek mutu: ED ≥ `supply.min_expiry_months` (pengecualian wajib alasan), suhu rantai dingin, kondisi kemasan.
- Baris ditolak wajib alasan.
- **Posting atomik dalam satu transaksi:**
  1. `postStockMovement(receipt)` + batch
  2. `avg_cost` rata-rata tertimbang
  3. `PayablesService.createFromGoodsReceipt` (U10)
  4. `postJournal` Persediaan D / Hutang usaha K
  5. Event `supply.goods_received` (B02 membuat draf aset untuk alkes modal)

**Retur, kedaluwarsa, opname:**

- Retur ke pemasok menghasilkan pergerakan keluar + nota debit (U10).
- Aksi kedaluwarsa: pindah ke depo pemakai terbesar (transfer fase 4) atau retur.
- Opname memakai metode cutoff: selisih = hitung − (snapshot + pergerakan bersih s.d. `counted_at`). Posting → penyesuaian + jurnal selisih persediaan.

**Endpoint:**

| Endpoint                                                                | Izin                                  |
| ----------------------------------------------------------------------- | ------------------------------------- |
| `POST /supply/purchase-orders` (Idempotency-Key)                        | `procurement.propose`                 |
| `POST /supply/purchase-orders/:id/{submit,approve,reject,order,cancel}` | approve/reject: `procurement.approve` |
| `POST /supply/goods-receipts`, `PUT …/lines`, `POST …/:id/post`         | `inventory.receive`                   |
| `POST /supply/returns`                                                  | `inventory.write`                     |
| `POST /supply/expiry-actions`                                           | `inventory.write`                     |
| `POST /supply/opnames`, `PUT …/lines`, `POST …/:id/post`                | `inventory.opname`                    |

**Tes:**

- Penerimaan → stok naik, hutang tercipta, jurnal debit = kredit.
- GR ganda serentak → 1.
- Periode tertutup → 409.
- SoD 403.
- ED pendek tanpa alasan → 400.
- Opname dengan pergerakan setelah cutoff benar.
- Retur menurunkan hutang.

**DoD:** penerimaan barang menambah stok dan hutang.

### 8.1c · Layar Logistik ke API (setelah 8.1b)

**Berkas:** `apps/web/src/app/(staf)/manajemen/logistik/`

- `page.tsx`, `api-logistik.tsx`, `demo-logistik.tsx`, `logistics-board.tsx`, `actions.ts`
- Baru: `po/[id]/page.tsx` (detail + setujui/tolak), `penerimaan/[id]/page.tsx`, `opname/page.tsx`, `master/page.tsx`

**Aturan:** Server Action mode api hanya mengirim ID + jumlah; nominal dihitung API.

**Tes:**

- Unit model tampilan.
- E2E `apps/web/e2e/logistik.spec.ts` (desktop + tablet): scan ROP → usulan → manajemen menyetujui → PO → penerimaan batch/ED → stok di layar naik. Hutang dan jurnal diperiksa lewat DB uji.
- E2E demo tetap hijau.

### 8.2 · B03 SDM inti + jadwal dinas + offboarding

**API** (`/api/v1/hr`):

| Endpoint                                                 | Izin / perilaku |
| -------------------------------------------------------- | --------------- |
| `employees` (NIK tersamar; buka utuh diaudit)            | `hr.read/write` |
| `employees/:id/events` (masuk, mutasi, keluar beralasan) | `hr.write`      |
| `rosters` (draf → terbit)                                | `hr.roster.*`   |
| `leaves`                                                 | ajukan/setujui  |
| `attendance/import` (CSV gagal-tertutup)                 | `hr.write`      |

**Offboarding:** event `keluar` (langsung, atau dijalankan job P11 pada tanggalnya) → `IamService` mengakhiri semua `staff_assignments`, menonaktifkan akun, mencabut sesi, mencatat audit.

**Layar Akses "Sinkron dari data SDM"** (menutup utang fase 1):

- `POST /iam/users/sync-from-hr` dengan pratinjau diff lalu terapkan.
- Izin `iam.users.write`; pengaman admin ADR-0012 tetap berlaku.

**Integrasi lain:**

- Anomali audit "akses di luar jam dinas" memakai jadwal terbit, dengan cadangan `audit.night_hours` (utang P04).
- Penanda "pasien karyawan" otomatis bila hash NIK pasien = hash NIK pegawai (dipakai 8.6a).
- `hr.leave_approved` untuk praktisi → F01 bisa mengusulkan pengganti (fase 2 pemilik aksi).

**Layar:** `apps/web/src/app/(staf)/manajemen/sdm/page.tsx`, `sdm/[id]/page.tsx`, `sdm/jadwal-dinas/page.tsx`.

**Tes:**

- Pegawai keluar → login 401 + sesi dicabut + audit.
- Admin terakhir tidak bisa di-offboard tanpa pengganti (409).
- Anomali jam dinas memakai jadwal.
- Isolasi tenant dan 403.

**DoD tambahan:** MRMIK 2.1b, akun nonaktif saat staf keluar.

### 8.3 · B04 kredensial, B05 penggajian, B02 aset (struktur, dapat dimatikan)

**B04 kredensial:**

- API `/api/v1/credentialing`: STR/SIP (pindaian lewat P08), katalog kewenangan, beri/tangguhkan/cabut (`credential.verify`, komite medik).
- `OrderGuard` (kait fase 3): order tanpa kewenangan, atau dengan SIP kedaluwarsa → `PRIVILEGE_REQUIRED` diblokir. Override darurat beralasan tercatat dan ditinjau komite.
- Job P11: SIP/STR ≤ 60 hari → notifikasi.

**B05 penggajian:**

- API `/api/v1/payroll`: komponen, run periode (`draft → calculated → approved → posted`), impor jasa pelayanan U08.
- PPh 21 diisi manual (struktur).
- Posting → jurnal beban/utang gaji.
- Slip dicetak HTML.

**B02 aset:**

- API `/api/v1/assets`: register (draf otomatis dari GR alkes), rencana pemeliharaan, work order, kalibrasi.
- Job pengingat jatuh tempo.

**Layar:** tidak ada (registri `belum`). B04 tampil sebagai tab di `manajemen/sdm/[id]`.

**Tes:**

- Kait guard memblokir dan override tercatat (dengan stub CPOE bila fase 3 belum digabung).
- Jurnal gaji seimbang.
- Modul mati → 404 `MODULE_DISABLED`.

### 8.4a · B06 mesin indikator mutu (ADR-0061)

**Sumber data:**

- View `qi_src_<kunci>` dengan `security_invoker = true` (RLS tetap berlaku).
- Keluaran: `(tenant_id, unit_id, day_wib, numerator, denominator)`.
- View hanya dibuat bila tabel sumbernya ada. Bila belum, kalkulator berstatus `unavailable`.

**Target otomatis:**

| Indikator                            | Sumber |
| ------------------------------------ | ------ |
| INM-01 kebersihan tangan, INM-02 APD | B07    |
| INM-03 identifikasi pasien           | eMAR   |
| INM-04 SC emergensi                  | S06    |
| INM-05 waktu tunggu RJ ≤ 60 menit    | F04    |
| INM-06 penundaan operasi elektif     | S06    |
| INM-07 visite                        | K07    |
| INM-08 lapor nilai kritis            | S09    |
| INM-09 Fornas                        | S04    |
| INM-11 pencegahan jatuh              | K06    |
| INM-12 tanggap komplain              | B13    |
| INM-13 kepuasan                      | B13    |
| IMP resume ≤ 1×24 jam                | K13    |
| IMP lapor IKP ≤ 2×24 jam             | B06    |

INM-10 clinical pathway diisi manual.

**Perhitungan:**

- Job P11 `quality.compute_daily` 01.30 WIB: hari kemarin + bulan berjalan per tenant yang mengaktifkan B06. Hasil append-only; hitung ulang = baris pengganti.
- `POST /quality/indicators/recompute` (≤ 31 hari, sinkron, `quality.manage`).
- `POST /quality/indicators/:code/manual` (isian manual; pengganti wajib alasan).

**Tes:**

- Satu tes per view dengan baris sumber fiktif → pembilang/penyebut tepat.
- RLS view: tenant B tidak terhitung.
- Hitung ulang idempoten.
- Batas hari WIB vs UTC (ADR-0014).

**DoD:** minimal 5 indikator otomatis. Target 13 otomatis + 1 manual.

### 8.4b · B06 IKP, investigasi, register risiko, layar Mutu (setelah 8.4a)

**IKP:**

- `POST /quality/incidents`: `incident.report` (semua staf). Laporan beku setelah dikirim; koreksi lewat addendum.
- Grading dari matriks kemungkinan × dampak dihitung server.
- Batas waktu investigasi 7 hari (sederhana) / 45 hari (RCA).
- Sentinel → notifikasi in-app + WhatsApp ke manajemen tanpa PHI.
- **Identitas pelapor** hanya terlihat oleh pemegang `incident.investigate`.
- Pasien disimpan sebagai FK; tampil hanya RM. Pembacaan diaudit dengan `patientId`.

**Endpoint lain:**

- `GET /quality/incidents` (`incident.read`).
- `/:id/{grade,investigation,actions,close}` (`incident.investigate`).
- `/quality/risks` + asesmen ulang (`risk.write`).
- `/quality/overview` mengikuti kontrak `qualityOverviewSchema`.

**Layar:**

- `apps/web/src/app/(staf)/manajemen/mutu/{api-mutu.tsx, demo-mutu.tsx, ikp/[id]/page.tsx, risiko/page.tsx}`.
- `apps/web/src/app/(staf)/lapor-insiden/page.tsx`: tautan sidebar untuk semua posisi.

**Tes:**

- Pelapor tersembunyi dari `incident.read`.
- Grading server.
- Sentinel memicu notifikasi.
- E2E `apps/web/e2e/mutu.spec.ts`: seed baris sumber → hitung ulang → ≥ 5 indikator berlabel "otomatis" dengan pembilang/penyebut. Lapor IKP sebagai perawat → muncul di daftar auditor mutu.

### 8.5 · B07 PPI, B08 PPRA, B10 pendidikan, B11 onkologi (struktur)

**B07 PPI** (`/api/v1/ipc`):

- Audit kebersihan tangan (5 momen) dan APD → INM-01/02.
- Sensus device-days harian.
- Kasus HAI: PHI, `ipc.read`, diaudit.
- Laju per 1.000 device-days.
- Bundle memakai formulir P07.
- Layar `apps/web/src/app/(staf)/manajemen/ppi/page.tsx`.

**B08 PPRA** (`/api/v1/ams`):

- Master restriksi (akses/pengawasan/cadangan).
- `OrderGuard`: antibiotik terbatas → order `pending_approval` → `ams.approve` (tim PPRA) setujui/tolak beralasan, kedaluwarsa 24 jam.
- Laporan DDD/100 hari rawat (view dispensing × hari rawat).
- Antibiogram: view hasil mikro.

**B10 pendidikan:** peserta didik + supervisor + rotasi + logbook terverifikasi. Supervisor dipakai untuk merutekan co-sign K07.

**B11 onkologi:**

- Regimen + rencana siklus + LPT Mosteller (fungsi murni di shared).
- Verifikasi ganda oleh dua pelaku berbeda.

**Tes:**

- Laju PPI.
- Penahanan dan persetujuan PPRA (stub CPOE).
- Verifikasi ganda menolak pelaku yang sama.
- Mosteller golden.
- Modul mati → 404.

### 8.6a · B09 pelepasan informasi, hak subjek data, log akses, penanda rahasia (ADR-0062)

**Pelepasan informasi (ROI):**

- Status: `diajukan → identitas_diverifikasi → disetujui → dirilis | ditolak`.
- Pemohon: pasien, keluarga, kuasa, asuransi, penegak hukum, atau faskes. Identitas pemohon terenkripsi.
- Dasar: `privacy_consents` atau dasar hukum.
- Lingkup: jenis dokumen / rentang / kunjungan.
- Penyetuju (`record.release.approve`) ≠ petugas penerima permintaan.
- Tenggat `roi.response_hours`.

**Rilis:**

- Paket PDF P12 dengan watermark nama pengakses + waktu per halaman.
- Diunduh lewat route handler BFF (`attachment`), tautan sekali pakai berumur 24 jam, audit `export`.
- Event `record.release_completed`.

**Log akses pasien:**

- `GET /medical-records/patients/:id/access-log` (petugas RM/privasi) dari `audit_events`: peran, unit, aksi, waktu, nama.
- Versi untuk pasien (fase 9) tanpa nama staf.

**Penanda rahasia/VIP/karyawan:**

- Dipasang lewat `patient.confidentiality.write` dengan alasan.
- Nama tersamar di permukaan semi-publik (display, papan, worklist bersama).
- Setiap akses masuk ringkasan anomali "pasien VIP/karyawan" untuk petugas privasi (docs/05 §1).

**Tes:**

- SoD.
- Watermark ada.
- Unduh kedua → 410.
- Log akses memuat pembacaan yang sesuai.
- Penanda memicu temuan.
- ABAC relasi tidak berubah.

### 8.6b · B09 berkas, retensi, pemusnahan, kelengkapan, audit RM (setelah 8.6a)

**Peminjaman berkas lama:**

- Lokasi rak, keluar/kembali, jatuh tempo `record.loan_days`.
- Job pengingat keterlambatan.

**Retensi:**

- Kebijakan per jenis dokumen / kelompok kasus + penanda **simpan permanen** (resume, consent, identitas, laporan operasi).
- Legal hold.

**Pemusnahan berjejak:**

- Kandidat dihitung sistem → tinjauan komite RM (`propose`) → persetujuan direktur/manajemen (`approve`) → berita acara P08 + TTE → `execute`.
- **Eksekusi hanya untuk berkas fisik.** Untuk data elektronik, sistem membuat kandidat + berita acara, tetapi eksekusinya ditolak `RETENTION_ELECTRONIC_DISABLED` sampai ada ADR crypto-shredding. Masa simpan RME 25 tahun, jadi belum ada kandidat elektronik.
- Metadata pemusnahan disimpan permanen.

**Kelengkapan RM (MRMIK 12c):**

- Job saat pulang + 24 jam menghitung skor per kunjungan: dokumen wajib per setting, TTE, resume tepat waktu, CPPT terverifikasi.

**Audit RM (MRMIK 12b):**

- Sampel acak terstratifikasi per unit / PPA / status rawat; instrumen formulir P07.

**Laporan (MRMIK 8d, 9b):** koreksi per PPA/unit, entri terlambat (`recorded_at − occurred_at`), entri tanpa TTE, kode `.9`/kosong. Ekspor CSV memakai pola ekspor P04 (anti formula injection, diaudit).

**Tes:**

- Item simpan permanen / legal hold tidak pernah jadi kandidat.
- Urutan persetujuan tidak bisa dilompati.
- Eksekusi elektronik ditolak.
- Skor kelengkapan golden.
- Sampel deterministik per benih.

### 8.6c · Layar RM administratif

**Berkas:** `apps/web/src/app/(staf)/rekam-medis/administrasi/page.tsx` dengan tab Pelepasan informasi · Peminjaman · Retensi & pemusnahan · Kelengkapan & audit, ditambah `pelepasan-informasi/[id]/page.tsx` dan `pemusnahan/[id]/page.tsx`.

**Tes:** E2E `apps/web/e2e/rm-administrasi.spec.ts` mencakup siklus ROI, unduh berwatermark, dan peminjaman.

### 8.7 · B12 dokumen regulasi + B13 pengaduan dan survei

**B12 DMS** (`/api/v1/regdocs`):

- Jenis dokumen + tingkat pemilik/RS/unit (MRMIK 3c), templat per jenis (3b).
- Versi `draft → review → approved (regdoc.approve) → published → obsolete`. Berkas PDF di P08; usang tetap tersimpan dengan watermark "TIDAK BERLAKU".
- Distribusi ke unit + tanda terima baca.
- Pengingat tanggal tinjau ulang (P11).
- `GET /regdocs/by-tag/:tag` agar SPO bisa ditautkan dari layar klinis.

**B13 pengaduan:**

- Kanal: loket, telepon, WA, aplikasi, web.
- Grading merah/kuning/hijau → SLA (INM-12).
- Tindakan append-only.

**B13 survei:**

- `encounter.finished/discharged` → tunda `survey.delay_hours` → undangan lewat operasi WhatsApp pasien fase 2 (tautan saja, tanpa isi klinis).
- Halaman publik `apps/web/src/app/survei/[token]/page.tsx`: tanpa login, token 256 bit (hanya hash yang disimpan), sekali pakai, kedaluwarsa 7 hari, rate limit, tanpa PHI.
- Formulir survei memakai P07 → INM-13.

**Layar:** `apps/web/src/app/(staf)/manajemen/dokumen/page.tsx`, `manajemen/pengaduan/page.tsx`.

**Tes:**

- Token sekali pakai / kedaluwarsa / tebakan → 404 seragam.
- SLA komplain.
- Versi terbit beku.
- Hanya versi terbit yang tampil ke unit.

### 8.8 · Penutup fase 8

- E2E DoD: logistik + mutu.
- Review keamanan (`/review-keamanan`) untuk 13 modul.
- ADR-0060…0064.
- `docs/panduan` (modul baru, cara menambah kalkulator indikator).
- Regresi E2E demo + QA visual layar baru.
- PROGRESS (agen penggabung).
- `pnpm db:akun-presentasi` diperluas ke 5 peran baru.

## 3. Paralelisasi (maks. 4 agen sekaligus)

**Gelombang:**

- 8.0a → 8.0b berurutan. 8.0b boleh dipecah dua agen: blok migrasi `supply+people` dan `governance`.
- **Gelombang A:** 8.0b ∥ 8.0c.
- **Gelombang B:** 8.1a ∥ 8.2 ∥ 8.4a ∥ 8.6a.
- **Gelombang C:** 8.1b ∥ 8.3 ∥ 8.4b ∥ 8.6b.
- **Gelombang D:** 8.1c ∥ 8.5 ∥ 8.6c ∥ 8.7.
- **Gelombang E:** 8.8 (agen penggabung).

**Kepemilikan berkas:**

| Berkas                                                                        | Pemilik                                                                              |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `packages/shared/src/{authz,settings,numbering}.ts`, `schemas/manajemen.ts`   | 8.0a. Setelahnya hanya lewat penggabung.                                             |
| `packages/db/prisma/schema.prisma`                                            | 8.0b. Potongan lanjutan menambah blok model bertanda + migrasi di blok cap waktunya. |
| `apps/api/src/modules/supply-chain/**`                                        | 8.1a → 8.1b (agen yang sama)                                                         |
| `hr/**`                                                                       | 8.2                                                                                  |
| `credentialing/**`, `payroll/**`, `assets/**`                                 | 8.3                                                                                  |
| `quality/**`                                                                  | 8.4a → 8.4b                                                                          |
| `ipc/**`, `ams/**`, `education/**`, `oncology/**`                             | 8.5                                                                                  |
| `medical-records-admin/**`                                                    | 8.6a → 8.6b                                                                          |
| `regulatory-docs/**`, `patient-experience/**`                                 | 8.7                                                                                  |
| `app.module.ts`, peta job P11 worker, `operations.ts`, `screens.ts`, `nav.ts` | satu baris per potongan                                                              |
| `docs/PROGRESS.md`                                                            | hanya agen penggabung                                                                |

## 4. Keputusan (keputusan diambil, disetujui otomatis 5 Okt 2026)

1. **Buku stok:** satu buku stok milik modul `supply-chain` (dibuat fase 4, diperluas fase 8). Valuasi rata-rata tertimbang bergerak. Pengambilan fisik FEFO. Harga termasuk pajak; rincian PPN di U10 (ADR-0060).
2. **e-katalog:** tanpa integrasi LKPP. Kanal + nomor paket dicatat manual.
3. **Persetujuan PO:** selalu oleh `procurement.approve`, penyetuju ≠ pengusul. PO darurat tidak melewati persetujuan; hanya diprioritaskan dan diberi notifikasi.
4. **Penerimaan:** stok, hutang, dan jurnal diposting atomik dalam satu transaksi, idempoten per GR.
5. **Opname:** metode cutoff tanpa membekukan dispensing.
6. **Peran baru:** `petugas_logistik`, `petugas_sdm`, `komite_medik`, `komite_ppi`, `tim_ppra`. docs/05 §2 diperbarui (ADR-0063).
7. **Pegawai keluar:** penugasan diakhiri + akun nonaktif + sesi dicabut otomatis pada tanggal keluar. Admin terakhir dilindungi.
8. **Indikator mutu:** dihitung dari view `security_invoker` + kalkulator di kode (bukan SQL bebas dari pengguna). Hasil harian append-only. Sasaran bawaan INM bisa diubah per RS. Dasbor fase 9 memakai hasil yang sama (ADR-0061).
9. **IKP:** pelapor tersembunyi kecuali bagi investigator. Pasien hanya tampil RM. Laporan beku + addendum.
10. **Kredensial:** tanpa kewenangan atau SIP kedaluwarsa → order diblokir, override darurat beralasan. Antibiotik terbatas → order ditahan sampai PPRA menyetujui.
11. **Pemusnahan:** dieksekusi hanya untuk berkas fisik. Data elektronik: kandidat + berita acara saja, eksekusi menunggu ADR crypto-shredding (ADR-0062).
12. **Rilis ROI:** PDF berwatermark lewat P12. Tautan unduh sekali pakai 24 jam. Penyetuju ≠ penerima permintaan.
13. **Log akses untuk pasien:** peran/unit/waktu tanpa nama staf. Nama hanya untuk petugas privasi.
14. **Pasien VIP/karyawan:** nama tersamar di permukaan semi-publik + temuan otomatis, tanpa mengubah ABAC.
15. **Survei:** lewat tautan WhatsApp ke halaman publik bertoken, tanpa PHI (ADR-0064).
16. **Struktur dasar:** B02/B05/B10/B11 hanya API (layar `belum`). B04 tab di SDM. PPh 21 manual.
17. **Modul aktif bawaan:** B01/B03/B09 bawaan aktif. Lainnya dinyalakan per RS; seed tenant pilot menyalakan B06/B07/B13.

## 5. Risiko & utang

- **Kepemilikan buku stok** dengan fase 4: dinyatakan di §1. Bila menyimpang, 8.0b memuat refaktor terbatas, bukan buku kedua.
- **View indikator** bergantung skema modul lain: tes per view, status `unavailable` bila sumber belum ada, versi kalkulator dicatat di hasil.
- **Definisi INM** mengikuti teks Kemenkes. Sasaran dan definisi operasional dikonfirmasi komite mutu RS (catat di PROGRESS).
- **Teks bebas IKP/HAI berisi PHI:** dibatasi izin + audit baca, tanpa enkripsi kolom (setara catatan klinis).
- **Watermark ROI** bergantung pada P12 (fase 3). Bila belum ada, 8.6a tertahan.
- **Utang yang ditinggalkan:**
  - Crypto-shredding elektronik.
  - Integrasi e-katalog LKPP.
  - Perhitungan PPh 21.
  - Mesin presensi.
  - SPO tertaut di setiap layar klinis (baru endpoint tag).
  - Antibiogram masih sederhana.
- **Akun presentasi** bertambah 5 posisi; naskah presentasi diperbarui.
- **ID fixture demo** manajemen → UUID (8.0c).

## 6. Definisi selesai fase 8 → potongan

| Kriteria                                                                                               | Potongan                                                |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| ROP menghasilkan usulan PO; penerimaan barang menambah stok dan hutang                                 | 8.0b, 8.1a, 8.1b, 8.1c, 8.8                             |
| Minimal 5 indikator mutu dihitung otomatis dari data transaksi                                         | 8.0a, 8.4a, 8.4b, 8.5 (INM-01/02), 8.7 (INM-12/13), 8.8 |
| (Katalog/MRMIK) Akun nonaktif saat pegawai keluar; ROI + log akses pasien; retensi/pemusnahan berjejak | 8.2, 8.6a, 8.6b, 8.6c                                   |
| Aturan umum (migrasi, seed, tes izin + isolasi, audit, teks Indonesia, lint/typecheck/test hijau)      | setiap potongan; diperiksa di 8.8                       |

---
