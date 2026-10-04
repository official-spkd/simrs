# Rencana fase 5 · Keuangan (U01–U10)

Disusun 5 Okt 2026. **Semua pilihan di §4 memakai opsi paling baku, aman, dan sederhana. Pemilik produk menyetujuinya otomatis 5 Okt 2026.**

- Nomor ADR 0038–0041 (dinomori ulang penggabung).
- Blok cap waktu migrasi `20261105HH0000`.

## 1. Ringkasan

Fase 5 membangun backend nyata untuk:

- **U01 tarif:** berkomponen, per kelas/penjamin/unit, berversi, plus aturan selisih naik kelas.
- **U02 charge capture:** murni dari event domain fase 2–4.
- **U03 billing dan kasir:** deposit, tagihan, diskon berpersetujuan, kuitansi, tunai/EDC manual, shift kasir.
- **U04 penjaminan dan piutang:** pembagian porsi pasien vs penjamin, umur piutang.
- **U05 klaim BPJS:** E-Klaim mock: grouper → final → kirim → status → dibayar.
- **U06 workbench koder.**
- **U07 akuntansi:** COA, jurnal otomatis per event, buku besar, laporan, tutup periode.
- **U08 jasa pelayanan:** akrual + rekap.
- **U09 kas dan bank:** rekonsiliasi dasar.
- **U10 hutang usaha.**

Layar Kasir (tanpa kanal TPDI), Klaim & koding, dan Akuntansi disambungkan ke API. Ditambah satu halaman sederhana "Tarif & aturan". Jalur demo tetap hidup dan dibekukan. Layar Pembayaran digital dan Pembiayaan tetap demo sampai fase 6.

Urutan pengerjaan:

1. Kontrak, lalu DB. Fondasi web paralel.
2. Infrastruktur konsumen event, konektor E-Klaim, mock, tarif, dan inti buku besar.
3. Charge capture, koding/grouping, penjaminan, bank/hutang.
4. Kasir dan jasa pelayanan.
5. Klaim final sampai dibayar, laporan, dan tutup periode.
6. Penutup E2E DoD.

**Prasyarat:** fase 4 selesai, dan antarmuka berikut tersedia.

| #    | Antarmuka                                                                                                                                                                                                                                                         | Dipakai        |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| F2-1 | `encounters` + riwayat status. `coverages`: penjamin, hak kelas, kelas rawat, plafon dan surat jaminan asuransi — bila belum ada, 5.0b menambah `coverage_guarantees`. `seps` (`issued`), `payers`.                                                               | 5.4–5.10       |
| F2-2 | Event `encounter.registered`, `coverage.changed`, `sep.issued`. Layanan antrean `K` (kasir). Pola Idempotency-Key. Outbox `defer`/`onDead`/galat bisnis. SSE. P11.                                                                                                | 5.1a–5.7       |
| F3-A | Event `bed.occupied`, `bed.transferred` (kelas), `encounter.discharged` (waktu, cara pulang), `encounter.finished` (RJ), `visit.recorded` (CPPT DPJP), `procedure.performed`, `consult.answered`, `medication.administered` (tanda stok ruangan), `resume.signed` | 5.4, 5.5, 5.10 |
| F3-B | `conditions_current` / `procedures_current` per encounter (ICD-10/ICD-9-CM, peran utama/sekunder). Jawaban DPJP atas query koder = koreksi diagnosis berversi di RME.                                                                                             | 5.5            |
| F4-A | Event fase 4 (lab/rad/farmasi/OK/darah/diagnostik), `stock_batches.unit_cost`, `suppliers`, `stock.received`                                                                                                                                                      | 5.4, 5.8, 5.11 |

**Batas dengan fase 6:**

- Fase 5 memiliki `payments` (tunai, EDC manual), `deposits`, `refunds` satu tingkat, dan rekonsiliasi 2 arah.
- Fase 6 menambah `payment_intents` (kolom `payments.payment_intent_id` disiapkan nullable), kanal VA/QRIS/EDC terintegrasi, cicilan, refund bertingkat, rekonsiliasi 3 arah, dan pembiayaan atas klaim `payable`.

## 2. Potongan kerja (urut dependensi)

Aturan tabel sama dengan fase 4, ditambah:

- Semua nominal `bigint`, nol atau positif, kecuali kolom bertanda yang dinyatakan eksplisit.
- Persen disimpan sebagai basis poin.
- Pembagian memakai sisa terbesar (largest remainder), sehingga jumlah bagian selalu eksak.
- **Dokumen keuangan final immutable:** baris tagihan final, pembayaran, jurnal terposting, tarif disetujui. Koreksi lewat dokumen pembalik beralasan.

### 5.0a · Kontrak bersama (`packages/shared`)

**Katalog izin:**

- `tariff` (read, write, approve)
- `charge` (read, write, void)
- `billing` (read, write, approve)
- `payment` (receive, void)
- `deposit` (receive, refund)
- `cashier_shift` (open, close)
- `receivable` (read, write, write_off)
- `claim` (read, code, submit, respond, audit)
- `accounting` (read, write, approve, close, reopen)
- `coa` (write)
- `bank` (read, import, reconcile)
- `payables` (read, write, approve, pay)
- `fee_sharing` (read, write, approve)

**Matriks bawaan:**

| Peran        | Izin                                                                                                                                                                      |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| kasir        | `billing` read/write, `charge` read/write, `payment.receive`, `deposit.receive`, `cashier_shift`, `receivable.read`                                                       |
| koder        | `claim` (termasuk `audit`), `billing.read`, `charge.read`                                                                                                                 |
| akuntan      | `accounting` read/write/close, `coa`, `bank`, `receivable` read/write, `payables` read/write, `fee_sharing` read/write, `tariff` read/write, `billing.read`, `claim.read` |
| manajemen    | semua `approve`, `payment.void`, `deposit.refund`, `accounting.reopen`, `receivable.write_off`, `payables.pay`                                                            |
| admin_tenant | `tariff.write`                                                                                                                                                            |

Migrasi data izin ke peran yang sudah berjalan, seperti fase 2.

**Penomoran:**

- `receipt` `KW-YYMM-NNNNN`, `deposit` `DP-YYMM-NNNNN`, `credit_note` `NK-YYMM-NNNNN`, `vendor_bill` `TH-YYMM-NNNNN`.
- `journal` diperlebar menjadi `JU-YYMM-NNNNNN` (keputusan #13; regex `journalEntrySchema` ikut diubah).

**Pengaturan:**

- `billing.manual_reason_min` (15)
- `claim.submission_deadline_days` (180, peringatan saja)
- `accounting.close_requires_bank_recon` (true)
- `cashier.variance_tolerance` (0)
- `fee_sharing.bpjs_realization` (true)

**Aturan murni** ke `rules/{billing,split,accounting,coding}.ts`:

- `invoiceTotal`, `recomputeSplit`, `invoiceSettlement`, `manualLineProblems` (dari `lib/keuangan.ts`)
- `journalBalanced` (dari `schemas/keuangan.ts`, tetap di-re-export)
- baru: `splitBasisPoints` (sisa terbesar), `classUpgradeAmount(aturan, tarifAlt)`, validasi koding (validitas ICD, JK/umur, aturan dx utama, prosedur tanpa dx)

**Revisi `schemas/keuangan.ts`:**

- ID menjadi UUID.
- Skema masukan per aksi.
- Status klaim ditambah `grouping`, `final`, `ditolak`.
- Metode bayar dibagi: tersedia di fase 5 vs fase 6.

**Kontrak E-Klaim** `integrations/eklaim/{contract,crypto}.ts`. Metode: `new_claim`, `set_claim_data`, `grouper` stage 1/2, `claim_final`, `reedit_claim`, `send_claim_individual`, `get_claim_status`.

**Event fase 5:** `invoice.finalized`, `payment.received`, `payment.voided`, `deposit.received` / `applied` / `refunded`, `claim.status_changed`, `receivable.settled`, `vendor_bill.approved`, `period.closed`.

### 5.0b · Skema DB + migrasi + seed, setelah 5.0a

**U01 tarif:**

- `billable_items`: satu master yang merujuk katalog fase 3, formularium, kelas akomodasi, administrasi, visite, dan paket.
- `tariffs`:
  - kolom: item, kelas (null = semua), kelompok penjamin, unit, total, `valid_from`, `valid_until`, status
  - pembuat ≠ penyetuju (CHECK)
  - `EXCLUDE gist` mencegah dua tarif disetujui yang rentangnya tumpang tindih
  - beku setelah disetujui; satu-satunya UPDATE: `valid_until` diisi sekali saat diganti
- `tariff_component_amounts`: 6 komponen (jasa sarana, jasa medis, jasa paramedis, BHP, KSO, manajemen). Constraint trigger: Σ komponen = total.
- `tariff_packages` (+ item).
- `class_upgrade_rules`: berversi, metode + parameter basis poin, angka simulasi.
- `eklaim_tariff_categories`: pemetaan kategori tagihan → kategori `tarif_rs` E-Klaim.

**U02 charge capture:**

- `domain_event_consumptions`: (event, konsumen) unik, status, galat.
- `charge_items`:
  - kolom: encounter, item, tarif (versi), kelas, penjamin, qty (bertanda, ≠ 0), harga, nominal
  - CHECK `amount = qty × unit_price`
  - `source_event_id` + `line_key` unik
  - `reverses_id`; alasan wajib ≥ 15 untuk baris manual dan pembalik
  - `invoice_id` diisi sekali; UPDATE lain ditolak
- `charge_item_components`: Σ = nominal.
- `charge_exceptions`: `perlu-tarif`, `item-tak-dikenal`.

**U03 billing dan kasir:**

- `invoices`: draf → final → void. Total dan split dibekukan saat final.
- `invoice_lines`: snapshot baris saat final, immutable.
- `invoice_adjustments`: diskon; pemohon ≠ penyetuju (CHECK).
- `credit_notes`.
- `deposits` + `deposit_applications`.
- `refunds`: satu tingkat.
- `payments`:
  - metode `tunai` / `edc`, referensi approval, terminal, shift
  - `idempotency_key` unik
  - `payment_intent_id` nullable (dipakai fase 6)
- `payment_voids`: berpersetujuan.
- `receipts`.
- `cashier_shifts`: saldo awal, hitungan fisik, selisih + alasan.
- `cash_deposits`.

**U04 penjaminan dan piutang:**

- `guarantor_splits`:
  - CHECK `hospital_total = payer_pays + patient_share + hospital_absorbs`
  - mencatat versi aturan dan `grouper_result_id`
- `receivables`, `receivable_settlements`, `payer_billing_batches`.
- `receivable_writeoffs`: berpersetujuan.

**U05/U06 klaim dan koding:**

- `claims`: SEP wajib berstatus `issued` (FK + CHECK status saat final); status + riwayat append-only; ID E-Klaim; nilai diajukan/diverifikasi.
- `claim_codings`: append-only berversi, dengan sumber (id condition/procedure) dan tautan bukti.
- `coding_queries` + jawaban.
- `coding_rules`: saran deterministik.
- `grouper_results`: append-only; CBG, tarif, special CMG, `tarif_alt` per kelas, final.
- `claim_documents`, `claim_status_events`, `claim_disputes`.
- `coding_audits`: auditor ≠ koder (CHECK).

**U07 akuntansi:**

- `coa_accounts`: pohon akun, tipe, saldo normal, boleh diposting.
- `account_mappings`: kunci aturan posting → akun.
- `fiscal_periods`: terbuka/tertutup + `period_reopen_requests`.
- `journal_entries`:
  - sumber `(source_type, source_id, rule)` unik → posting idempoten
  - status: `perlu-pemetaan` / `posted` / `reversed`
  - pembuat ≠ penyetuju untuk jurnal manual
  - `reverses_id`
- `journal_lines`:
  - CHECK tepat satu sisi > 0
  - unit sebagai pusat biaya
- Constraint trigger `DEFERRABLE INITIALLY DEFERRED`: entri terposting harus seimbang saat commit.
- Trigger: insert ke periode tertutup ditolak; entri terposting immutable (satu-satunya UPDATE: status → `reversed`).

**U08 jasa pelayanan:** `fee_sharing_rules` (berversi, basis poin per komponen × peran pelaksana), `fee_allocations`.

**U09/U10 kas, bank, hutang:**

- `bank_accounts`: nomor tersamar + terenkripsi.
- `bank_statement_imports` (hash berkas) dan `bank_statement_lines` (append-only, `bank_ref` unik).
- `reconciliation_matches` + pengecualian.
- `vendor_bills` (+ baris; dari penerimaan stok) dan `vendor_payments`.

**Seed (fiktif):**

- COA seperti `AKUN` demo + akun kas kasir, kliring EDC, HPP, beban jasa, utang jasa, potongan pendapatan.
- Pemetaan akun.
- Periode: Sep tertutup, Okt terbuka.
- Tarif simulasi per kelas/penjamin untuk item seed.
- Aturan selisih kelas (simulasi).
- Aturan jasa (simulasi).
- 2 rekening BTN tersamar, loket `K`, pemasok.

**Tes db:**

- RLS.
- Commit jurnal tidak seimbang gagal.
- Insert ke periode tertutup gagal.
- Event yang sama → satu `charge_item`.
- Tarif immutable dan tidak tumpang tindih.
- CHECK pembuat ≠ penyetuju.
- `invoice_lines` immutable.
- Identitas pembagian penjamin.

### 5.0c · Fondasi web keuangan (paralel dengan 5.0b)

- **ID fixture:** `inv-*`, `ju-dispute-hendro`, dan ID klaim bernama pasien → UUID (bila belum oleh 0c fase 2).
- **Data per layar:** `lib/server/data/keuangan.ts` dipecah menjadi `kasir.ts`, `klaim.ts`, `akuntansi.ts`.
- **Halaman:** isi lama ke `demo-page.tsx` / `demo-actions.ts`; `requireScreen`.
- **Kasir:** di mode api, metode VA/QRIS/cicilan tampil nonaktif dengan label "tersedia di fase 6".
- **Kontrak:** regex nomor jurnal disesuaikan di fixture.
- **E2E demo** `e2e/demo/keuangan.spec.ts` tetap hijau.

### 5.1a · Infrastruktur konsumen event + job

- **Kerangka konsumen di worker:**
  - antarmuka `DomainEventConsumer { name, eventTypes, handle(tx, event) }`
  - per tenant, diurutkan menurut id UUID v7
  - at-least-once + handler idempoten
  - ledger `domain_event_consumptions`, retry, status `dead` terlihat
  - **backfill** dari awal event fase 3–4
  - metrik lag
- **Barrier:** `ChargeCaptureService.pending(encounterId)` = event encounter itu yang belum dikonsumsi + pengecualian terbuka.
- **Kanal SSE:** `billing:<encounter>`, `claim:<id>`.
- **Job P11:**
  - polling status E-Klaim untuk klaim `sent`/`pending`, tiap 15 menit
  - ringkasan HPP harian per depo, 00.30 WIB
  - ambil mutasi BTN harian
  - pengingat shift kasir terbuka > 12 jam
- **Tes:**
  - event diproses dua kali → satu efek
  - urutan per tenant
  - tidak bocor antar-tenant
  - backfill tidak menggandakan
  - konsumen gagal tidak memblokir konsumen lain

### 5.1b · Konektor E-Klaim (worker)

- **Operasi outbox berantai** per klaim, masing-masing satu pesan. `defer` bila langkah sebelumnya belum selesai:
  - `eklaim.new_claim`
  - `eklaim.set_claim_data`: `tarif_rs` per kategori dari baris tagihan, LOS, cara pulang, kelas, naik kelas
  - `eklaim.grouper` (stage 1, lalu 2)
  - `eklaim.claim_final`
  - `eklaim.send_claim`
  - `eklaim.get_status`
  - `eklaim.reedit`
- **Idempotency:** `eklaim:<claim>:<langkah>:<versi koding>`.
- **Enkripsi:** meniru E-Klaim (AES-256-CBC + tanda tangan HMAC), bisa dimatikan lewat flag debug seperti BPJS.
- **Galat:**
  - `metadata.code ≠ 200` → kode internal stabil (`EKLAIM_SEP_NOT_FOUND`, `EKLAIM_CLAIM_FINAL`, …), status klaim `ditolak` + pesan, **bukan** DLQ
  - `onDead` → status `gagal-kirim` + tombol kirim ulang yang diaudit
- **Hasil grouper** diproses atomik dengan pencatatan terkirim (ADR-0017), lalu SSE `claim:<id>`.
- **Tes:**
  - urutan langkah
  - E-Klaim mati → klaim tetap `grouping`, pulih → selesai
  - galat bisnis tidak masuk DLQ
  - respons tanpa PHI di `delivery_attempts`

### 5.1c · Mock E-Klaim lengkap + mutasi BTN

- **`apps/mock/src/systems/eklaim.ts`:**
  - state per SEP, semua metode, enkripsi
  - grouper berbasis tabel kecil simulasi, selaras dengan tabel `CBG` di fixture demo: `tarif_alt` per kelas + opsi special CMG; tarif berlabel simulasi
  - validasi: tanpa dx utama → galat
  - `claim_final` mengunci klaim
- **Panel:**
  - verifikator set status layak bayar / pending (alasan) / dispute
  - "BPJS bayar klaim" → membuat batch pembayaran + baris kredit di mutasi rekening penampungan
- **`apps/mock/src/systems/btn.ts`:** **hanya** endpoint mutasi (tambah sumber baris dari panel: setoran, settlement EDC, transfer asuransi). Bagian TPDI/pembiayaan milik fase 6.
- **Helper E2E** + reset.

### 5.2 · U01 Tarif dan aturan

- **API `/api/v1/tariffs`:**
  - daftar/cari per item × kelas × penjamin × tanggal
  - `POST` draf: Σ komponen = total
  - `POST :id/approve`: pemohon ≠ penyetuju; `valid_from` ≥ hari ini WIB (tidak retroaktif); versi lama ditutup
  - paket
  - `class-upgrade-rules`: berversi, berpersetujuan
  - `billable-items`
  - impor CSV gagal-tertutup lewat CLI `db:import-tariff` (pola `db:import-ref`)
  - `resolve` internal
- **Audit:** create/approve.
- **Web:** halaman baru `/keuangan/tarif` (tanpa mockup, gaya layar Akses): daftar, draf, setujui, aturan selisih kelas. Masuk registri sebagai `api`.
- **Tes:**
  - retroaktif ditolak
  - pembuat = penyetuju → 403
  - tumpang tindih → 409
  - isolasi, 403

### 5.3 · U07 Inti buku besar

- **Mesin posting:** `postJournal(rule, source, lines)`, idempoten per sumber.
  - Registri aturan: satu berkas per sumber di `modules/accounting/posting-rules/<sumber>.ts`.
  - Akun tidak terpetakan → draf `perlu-pemetaan` (tidak diposting).
- **API `/api/v1/accounting`:** `coa`, `mappings` (pemetaan maker-checker), `journals` (manual + `approve`, `reverse`), `periods`.
- **Peta transaksi → jurnal** (diimplementasikan di potongan pemilik sumbernya):

| Transaksi                                    | Debit                                                                                              | Kredit                                                          | Potongan |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | -------- |
| Tagihan final BPJS                           | Piutang BPJS RJ/RI (tarif CBG) + piutang pasien (porsi pasien) + selisih CBG (bila tarif RS > CBG) | Pendapatan per kategori (tarif RS) [+ selisih CBG bila surplus] | 5.7      |
| Tagihan final asuransi/umum                  | Piutang penjamin + piutang pasien                                                                  | Pendapatan                                                      | 5.7      |
| Deposit diterima / diterapkan / dikembalikan | Kas / uang muka / uang muka                                                                        | Uang muka / piutang pasien / kas                                | 5.7      |
| Bayar tunai / EDC                            | Kas kasir / kliring EDC                                                                            | Piutang pasien                                                  | 5.7      |
| Diskon disetujui                             | Potongan pendapatan                                                                                | Piutang pasien                                                  | 5.7      |
| Void bayar                                   | jurnal balik                                                                                       |                                                                 | 5.7      |
| Setoran kas / settlement EDC                 | Bank operasional (+ beban admin bank)                                                              | Kas kasir / kliring EDC                                         | 5.8      |
| Klaim final beda nilai                       | Piutang BPJS ±                                                                                     | Selisih CBG ±                                                   | 5.10     |
| Klaim dispute                                | Beban CKPN                                                                                         | CKPN piutang BPJS                                               | 5.10     |
| Klaim dibayar                                | Bank penampungan klaim                                                                             | Piutang BPJS                                                    | 5.10     |
| Pembayaran penjamin swasta                   | Bank operasional                                                                                   | Piutang penjamin                                                | 5.8      |
| HPP obat harian per depo / retur             | HPP / persediaan                                                                                   | Persediaan / HPP                                                | 5.11     |
| Tagihan pemasok disetujui / dibayar          | Persediaan / utang usaha                                                                           | Utang usaha / bank                                              | 5.8      |
| Penyesuaian stok                             | Selisih persediaan                                                                                 | Persediaan (atau sebaliknya)                                    | 5.11     |
| Akrual jasa pelayanan                        | Beban jasa pelayanan                                                                               | Utang jasa pelayanan                                            | 5.9      |
| Penghapusan piutang                          | CKPN / beban                                                                                       | Piutang                                                         | 5.6      |

- **Tes:**
  - properti fast-check: rangkaian operasi acak → setiap jurnal seimbang, neraca saldo = 0
  - jurnal manual pembuat = penyetuju → 403
  - jurnal terposting tidak bisa diubah
  - isolasi, 403

### 5.4 · U02 Charge capture

- **Konsumen** di `modules/charge-capture/consumers/`:

| Event                                                       | Baris tagihan                                                                                             |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `encounter.registered`                                      | administrasi RJ/IGD/RI                                                                                    |
| `bed.occupied` / `bed.transferred` / `encounter.discharged` | akomodasi per segmen kelas; hari = tanggal WIB keluar − masuk, minimal 1; ICU/HCU sebagai item tersendiri |
| `visit.recorded`                                            | visite, maksimal 1 per DPJP per hari                                                                      |
| `procedure.performed` / `consult.answered`                  | tindakan / konsultasi                                                                                     |
| `lab.specimen_received`                                     | per pemeriksaan                                                                                           |
| `radiology.exam_completed`                                  | per prosedur                                                                                              |
| `pharmacy.dispensed` / `pharmacy.returned`                  | obat/BHP / baris pembalik                                                                                 |
| `surgery.case_completed`                                    | jasa operator dan anestesi, sewa kamar per durasi, BHP/implan, atau paket bila ada                        |
| `blood.unit_issued`                                         | per kantong                                                                                               |
| `diagnostic.report_signed`                                  | per pemeriksaan                                                                                           |
| `medication.administered`                                   | hanya obat stok ruangan                                                                                   |
| `*.voided` / `order.cancelled` setelah tertangkap           | baris pembalik                                                                                            |
| `coverage.changed`                                          | baris terbuka di-reprice (balik + baris baru)                                                             |

- **Penentuan harga:** tarif yang berlaku saat layanan, untuk kelas yang ditempati dan penjamin saat itu. Tarif tidak ada → `charge_exceptions`, dicoba ulang otomatis setelah tarif disetujui.
- **API `/api/v1/billing`:**
  - `encounters/:id/charges` (sumber + waktu per baris)
  - `encounters/:id/charges/manual`: alasan ≥ 15, audit, ditandai
  - `charges/:id/void`: **hanya baris manual**. Baris klinis dikoreksi di unit asal.
  - `encounters/:id/capture-status`
  - `charge-exceptions` (+ `retry`)
- **Audit:** read dengan `patientId`, create manual.
- **Tes:**
  - rekonsiliasi: setiap event yang bisa ditagih di skenario uji → baris bersumber, atau pengecualian eksplisit
  - Σ baris = Σ (qty × tarif) — properti
  - backfill tidak dobel
  - item manual tanpa alasan → 400
  - void baris klinis → 403
  - isolasi; 403 untuk koder (write)
- **DoD:** baris tagihan bersumber.

### 5.5 · U06 Koding + grouping (U05 bagian 1)

- **Draf klaim** dibuat otomatis oleh konsumen `encounter.finished` / `encounter.discharged` untuk penjamin BPJS. Tanpa SEP `issued` → klaim berstatus terblokir `SEP_REQUIRED` dan terlihat di daftar.
- **API `/api/v1/claims`:**
  - worklist koder
  - `:id/coding`:
    - tarik dx/px dari F3-B
    - saran dari `coding_rules`
    - validasi
    - tautan bukti; kode yang butuh bukti tanpa tautan → wajib alasan ≥ 10
    - versi baru wajib alasan
  - `:id/queries` → notifikasi DPJP; jawabannya berupa koreksi di RME
  - `:id/group` → rantai 5.1b; hasil lewat SSE
  - `audits` (sampel; auditor ≠ koder)
- **Koder tidak pernah mengubah data RME.**
- **Web:**
  - `components/keuangan/{claim-codes,claim-grouper,claim-docs}.tsx` membaca API
  - `page.tsx` dan `actions.ts` dirangkai 5.10
- **Tes:**
  - grouping via mock tersimpan
  - E-Klaim mati → `grouping` lalu pulih
  - versi koding beralasan
  - isolasi; 403 untuk kasir
- **DoD:** klaim (koding → grouper).

### 5.6 · U04 Penjaminan dan piutang

- **`GuarantorSplitService.compute`:**
  - **BPJS:** penjamin membayar tarif CBG hak kelas dari `grouper_results` terbaru; pasien menanggung `classUpgradeAmount` sesuai aturan berversi pada tanggal layanan (angka simulasi).
  - **Asuransi:** penjamin sampai plafon / surat jaminan; kelebihan ke pasien.
  - **Perusahaan:** sesuai kontrak.
  - **Umum:** seluruhnya ke pasien.
  - Identitas pembagian dijaga CHECK.
- **API `/api/v1/receivables`:**
  - umur piutang 0–30 / 31–60 / 61–90 / > 90 hari, dihitung per tanggal WIB
  - daftar per penjamin
  - pelunasan manual bereferensi
  - batch penagihan asuransi/perusahaan (cetak HTML)
  - hapus buku berpersetujuan + jurnal
- **Web:** `payer-split-card.tsx` (dirangkai 5.7) dan `aging-card.tsx` (dirangkai 5.11) membaca API ini.
- **Tes:**
  - identitas pembagian
  - versi aturan menurut tanggal
  - plafon; pembulatan
  - batas umur piutang
  - isolasi, 403

### 5.7 · U03 Kasir + shift (U09)

- **API `/api/v1/billing` (kasir):**
  - papan: encounter siap tagih + tiket antrean `K`
  - tagihan draf (berjalan)
  - `invoices/:id/finalize` → 409 bila:
    - `CHARGES_PENDING` (barrier belum kosong)
    - kunjungan belum selesai/pulang
    - naik kelas BPJS tanpa hasil grouper (`GROUPER_REQUIRED`)
  - finalize berhasil → baris dibekukan → nomor INV → jurnal pengakuan → `invoice.finalized`
  - diskon: ajukan/setujui oleh pengguna lain
  - deposit: terima / terapkan / kembalikan (berpersetujuan)
  - `payments`:
    - tunai atau EDC manual (kode approval wajib)
    - Idempotency-Key wajib
    - nominal ≤ sisa
    - kuitansi
  - void pembayaran: berpersetujuan + jurnal balik
  - cetak kuitansi (HTML A5/80 mm, audit `print`)
  - tutup kunjungan bila sisa = 0
  - shift: buka / tutup (selisih wajib alasan) / setoran
  - panggil antrean `K`
- **Kunci:** advisory lock per encounter untuk finalisasi dan pembayaran.
- **Web:**
  - `app/(staf)/keuangan/kasir/{page.tsx,actions.ts}`
  - `components/keuangan/{kasir-workspace,bill-queue,bill-lines,manual-line-form,payer-split-card,payment-panel,payment-methods,kasir-settlement,shift-close}.tsx` → API
  - `cicilan-box`, `scenario-payment` hanya untuk demo
  - status registri `kasir` → `api`
- **Tes:**
  - kirim ganda → satu pembayaran
  - lebih bayar → 422
  - finalisasi dengan event tertunda → 409
  - tagihan final tidak bisa diubah
  - diskon atau void disetujui sendiri → 403
  - shift selisih tanpa alasan → 400
  - isolasi; 403 untuk koder
- **DoD:** tagihan bersumber, kasir tidak menambah item tanpa alasan, jurnal seimbang.

### 5.8 · U09 Bank + U10 Hutang usaha

- **API `/api/v1/bank`:**
  - rekening
  - impor mutasi:
    - CSV: diunggah lewat body biner (pola ADR-0020), hash berkas, baris ganda diabaikan
    - atau ambil dari mock H2H lewat job
  - registri pencocok di `modules/cash-bank/matchers/`: setoran kas, settlement EDC (+ beban MDR), transfer penjamin. Pencocok pembayaran BPJS ditambahkan 5.10.
  - padankan manual / pengecualian dengan catatan
  - jurnal saat cocok
- **API `/api/v1/payables`:**
  - tagihan pemasok dari konsumen `stock.received` (draf) atau input manual
  - setujui (maker-checker)
  - jatuh tempo (KPI 7 hari)
  - bayar + jurnal
- **Web:** API saja; `bank-recon-card` dirangkai 5.11.
- **Tes:**
  - impor ganda tidak dobel
  - salah padan bisa dilepas dengan jurnal balik
  - maker-checker
  - isolasi, 403

### 5.9 · U08 Jasa pelayanan

- **Akrual:** konsumen `invoice.finalized` mengalokasikan komponen jasa ke pelaksana menurut aturan berversi.
- **BPJS:** direalisasikan saat `claim.status_changed: paid` dengan rasio = CBG dibayar ÷ tarif RS (sisa terbesar).
- **API:** `GET /api/v1/fee-sharing/recap?period` + ekspor CSV (diaudit, anti formula injection).
- **Jurnal akrual** saat tutup periode.
- **Web:** tanpa layar (keputusan #17).
- **Tes:** Σ alokasi = komponen; isolasi; 403.

### 5.10 · U05 Klaim final → kirim → status → dibayar

- **`POST /api/v1/claims/:id/final`** mewajibkan:
  - dokumen lengkap
  - resume ber-TTE (`resume.signed`)
  - SEP `issued`
  - tagihan final
  - laporan operasi ber-TTE bila kasus bedah
  - grouping selesai
  - lalu `claim_final` → `send_claim`
- **Status (polling):**
  - `pending`: tanggapan koder + berkas → `reedit` → kirim ulang
  - `dispute`: jurnal CKPN; banding
  - `payable`: data tersedia untuk pembiayaan fase 6
  - `paid`: dari pencocok `bpjs-claim-payment` (batch BTN) → piutang lunas
- **Transisi** hanya menurut graf yang diizinkan.
- **Web:**
  - `app/(staf)/keuangan/klaim/{page.tsx,actions.ts}` dan `components/keuangan/{claim-list,claim-detail,claim-scenario-controls}.tsx` → API
  - status registri `klaim` → `api`
- **Tes:**
  - final tanpa resume TTE → 409 `RESUME_NOT_SIGNED`
  - final tanpa SEP → 409 `SEP_REQUIRED`
  - galat bisnis → `ditolak`
  - transisi tidak sah → 409
  - pembayaran batch melunasi tepat klaimnya
  - jurnal seimbang
  - isolasi; 403 untuk kasir
- **DoD:** klaim berjalan.

### 5.11 · U07 Laporan, tutup periode, layar Akuntansi

- **Laporan:** buku besar, neraca saldo, laba rugi, neraca, arus kas metode langsung sederhana. Ekspor CSV diaudit.
- **Jurnal ringkasan:** HPP harian per depo, penyesuaian stok.
- **Tutup periode** — daftar periksa:
  - tidak ada draf `perlu-pemetaan`
  - semua shift tertutup
  - mutasi periode cocok atau pengecualiannya diakui
  - lag charge capture = 0 untuk tanggal periode
  - akrual jasa terposting
  - lalu kunci periode
- **Buka ulang:** `accounting.reopen` (manajemen) + alasan + audit.
- **KPI papan** dari server.
- **Web:**
  - `app/(staf)/keuangan/akuntansi/{page.tsx,actions.ts}` dan `components/keuangan/{accounting-workspace,journal-table,aging-card,bank-recon-card,period-close}.tsx` → API
  - tautan rekonsiliasi 3 arah nonaktif sampai fase 6
  - status registri `akuntansi` → `api`
- **Tes:**
  - jurnal, pembayaran, atau pembalik bertanggal periode tertutup → 409 `PERIOD_CLOSED` (API) dan ditolak trigger (DB)
  - properti fast-check penuh lintas operasi: kas, piutang, dan uang muka di buku besar = buku pembantu
  - isolasi, 403
- **DoD:** jurnal seimbang, periode tertutup.

### 5.12 · Penutup fase 5

- **E2E DoD:**
  1. RJ BPJS: registrasi → poli + lab + farmasi (API fase 3–4) → tagihan bersumber (admin, konsultasi, lab, obat) → item manual tanpa alasan ditolak → tutup dengan porsi pasien Rp 0.
  2. Koder memvalidasi → grouper mock → final → kirim → verifikator "layak bayar" → BPJS bayar → impor mutasi → dipadankan → `paid`; jurnal seimbang di tiap langkah.
  3. RI umum: deposit + diskon disetujui manajemen + EDC.
  4. Tutup periode → transaksi bertanggal periode itu ditolak → buka ulang beralasan.
- Juga: regresi demo, `/review-keamanan`, ADR, panduan, PROGRESS, QA visual.

## 3. Paralelisasi (maks. 5 agen sekaligus)

- 5.0a berjalan sendiri.
- **Gelombang A:** 5.0b ∥ 5.0c.
- **Gelombang B:** 5.1a ∥ 5.1b ∥ 5.1c ∥ 5.2 ∥ 5.3.
- **Gelombang C:** 5.4 ∥ 5.5 ∥ 5.6 ∥ 5.8.
- **Gelombang D:** 5.7 ∥ 5.9.
- **Gelombang E:** 5.10 ∥ 5.11, lalu 5.12.
- Jalur kritis: 5.0a → 5.0b → 5.2 → 5.4 → 5.7 → 5.10 → 5.12.

**Aturan kepemilikan berkas:**

- Kontrak shared milik 5.0a, lalu dibekukan.
- `schema.prisma` milik 5.0b; tambahan berikutnya hanya di bloknya sendiri.
- Aturan posting: satu berkas per potongan di `posting-rules/`; `index.ts` satu baris per potongan.
- Pencocok bank: registri milik 5.8; berkas `bpjs-claim-payment.ts` milik 5.10.
- Konsumen charge capture milik 5.4.
- Layar:
  - Kasir milik 5.7
  - Klaim: komponen koding/grouper/dokumen milik 5.5; `page.tsx`, `actions.ts`, list/detail milik 5.10
  - Akuntansi milik 5.11
  - Tarif milik 5.2
- `apps/mock/src/systems/eklaim.ts` milik 5.1c. Di `btn.ts`, 5.1c hanya mengubah endpoint mutasi.
- PROGRESS, panduan, dan nomor ADR hanya oleh agen penggabung.

## 4. Keputusan (semua diambil dan disetujui otomatis 5 Okt 2026)

1. **Konsumsi event:** **event tersimpan + konsumen asinkron idempoten di worker; finalisasi tagihan menunggu barrier event** (keputusan diambil, disetujui otomatis 5 Okt 2026). Alternatif: listener sinkron di transaksi klinis, yang berisiko menggagalkan layanan klinis karena galat billing.
2. **Titik tangkap per sumber:** **sesuai tabel 5.4; akomodasi per segmen kelas tanpa job harian** (keputusan diambil, disetujui otomatis 5 Okt 2026).
3. **Koreksi baris klinis:** **di unit asal → baris pembalik; kasir tidak membatalkan baris klinis** (keputusan diambil, disetujui otomatis 5 Okt 2026).
4. **Tarif** (keputusan diambil, disetujui otomatis 5 Okt 2026):
   - **satu master `billable_items`**
   - **berversi, tidak retroaktif, maker-checker, 6 komponen**
   - **harga obat per item formularium, bukan dari HPP batch**
5. **Item manual kasir:** **boleh dengan alasan ≥ 15 + audit + tanda. Diskon, void, dan refund disetujui pengguna lain (bawaan manajemen)** (keputusan diambil, disetujui otomatis 5 Okt 2026).
6. **Metode bayar fase 5:** **tunai + EDC manual. VA, QRIS, cicilan, dan EDC terintegrasi di fase 6** (keputusan diambil, disetujui otomatis 5 Okt 2026).
7. **BPJS naik kelas** (keputusan diambil, disetujui otomatis 5 Okt 2026):
   - **porsi pasien = aturan selisih berversi atas `tarif_alt` grouper**
   - **finalisasi menunggu hasil grouper (boleh belum final)**
   - **bila grouper final berbeda, selisihnya ditanggung RS; pasien tidak ditagih ulang**
8. **Pengakuan pendapatan:** **saat tagihan final pada tarif RS; piutang BPJS = tarif CBG; selisih ke akun pengurang. Tanpa akrual untuk pasien yang masih dirawat (dicatat sebagai utang)** (keputusan diambil, disetujui otomatis 5 Okt 2026).
9. **E-Klaim** (keputusan diambil, disetujui otomatis 5 Okt 2026):
   - **semua metode lewat outbox berantai, termasuk grouper; hasil via SSE; kirim individual**
   - **kredensial env tunggal (mock) di fase 5; per RS terenkripsi di fase 7**
   - **enkripsi meniru E-Klaim**
10. **Koding:** **koder tidak mengubah RME; `claim_codings` berversi; perbedaan lewat query DPJP** (keputusan diambil, disetujui otomatis 5 Okt 2026).
11. **Syarat klaim final:** **SEP `issued` + resume ber-TTE + tagihan final (+ laporan operasi bila bedah)** (keputusan diambil, disetujui otomatis 5 Okt 2026).
12. **Buku besar** (keputusan diambil, disetujui otomatis 5 Okt 2026):
    - **jurnal terposting immutable; koreksi lewat jurnal balik**
    - **keseimbangan dijaga constraint trigger deferrable; periode tertutup dikunci trigger**
    - **buka ulang hanya manajemen, beralasan**
    - **jurnal tanpa pemetaan akun = draf yang memblokir tutup periode; pemetaan akun dan jurnal manual maker-checker**
13. **Nomor jurnal:** **diperlebar menjadi `JU-YYMM-NNNNNN` + ringkasan harian HPP per depo** (keputusan diambil, disetujui otomatis 5 Okt 2026).
14. **Pembulatan:** **basis poin + sisa terbesar; tanpa float** (keputusan diambil, disetujui otomatis 5 Okt 2026).
15. **Tes properti:** **`fast-check` sebagai devDependency, dicatat di ADR** (keputusan diambil, disetujui otomatis 5 Okt 2026). Paket ini saat ini hanya ada sebagai dependensi transitif.
16. **Rekonsiliasi bank:** **2 arah (impor CSV + mock H2H); 3 arah dengan TPDI di fase 6** (keputusan diambil, disetujui otomatis 5 Okt 2026).
17. **Jasa pelayanan:** **akrual dari komponen tarif; BPJS proporsional setelah klaim dibayar; pembayaran ke dokter lewat penggajian B05 (fase 8); tanpa layar, cukup API + ekspor** (keputusan diambil, disetujui otomatis 5 Okt 2026).
18. **U10:** **tagihan pemasok dari penerimaan stok fase 4 atau input manual; tanpa layar (API + KPI)** (keputusan diambil, disetujui otomatis 5 Okt 2026).
19. **Layar baru tanpa mockup:** **hanya "Tarif & aturan"** — perlu karena aturan harus bisa diubah admin (keputusan diambil, disetujui otomatis 5 Okt 2026).
20. **Cetak kuitansi/tagihan:** **HTML dari browser** (keputusan diambil, disetujui otomatis 5 Okt 2026).
21. **Pajak:** **tidak dihitung di fase 5** (jasa kesehatan; PPh jasa dokter di B05) (keputusan diambil, disetujui otomatis 5 Okt 2026).
22. **Refund:** **satu tingkat di fase 5; bertingkat + kanal TPDI di fase 6** (keputusan diambil, disetujui otomatis 5 Okt 2026).
23. **Batas pengajuan klaim:** **180 hari (pengaturan), peringatan saja** (keputusan diambil, disetujui otomatis 5 Okt 2026).
24. **Pemisahan tugas:** **berbasis pengguna, bukan posisi. Satu akun yang memegang dua posisi tetap tidak bisa menyetujui miliknya sendiri** (keputusan diambil, disetujui otomatis 5 Okt 2026).
25. **Jalur demo:** **dipertahankan dan dibekukan** (keputusan diambil, disetujui otomatis 5 Okt 2026).
26. **ADR:** **blok 0038–0041** (keputusan diambil, disetujui otomatis 5 Okt 2026):
    - (a) charge capture dari event
    - (b) tarif berversi + aturan selisih kelas
    - (c) buku besar + periode
    - (d) konektor E-Klaim

## 5. Risiko dan utang yang ditangani

- **Nama event fase 2–4 bisa menyimpang** → kontrak event zod + tes kontrak; satu konsumen per event.
- **Backfill dan tarif:** event lama dihargai dengan tarif yang berlaku pada waktu layanan; seed tarif `valid_from` sebelum data uji; pengecualian terlihat.
- **Protokol E-Klaim resmi** (enkripsi, isian `set_claim_data`, `tarif_alt`) baru dirangkum dari docs/06 → dicocokkan dengan manual resmi sebelum integrasi nyata.
- **Aturan selisih kelas** memakai angka simulasi; perlu konfirmasi RS dan regulasi.
- **Kapasitas nomor jurnal** → 6 digit + ringkasan harian.
- **Bayar atau finalisasi serentak** → advisory lock per encounter + Idempotency-Key.
- **Format mutasi BTN belum diketahui** (docs/07 pertanyaan 3) → adaptor CSV per bank.
- **RS kecil dengan sedikit staf** sulit memenuhi maker-checker → tetap ketat; dicatat.
- **PHI di tagihan dan ekspor** → audit read/print/export + watermark.
- **Utang tersisa:**
  - akrual pendapatan pasien yang masih dirawat
  - arus kas sederhana
  - layar hutang usaha dan jasa pelayanan
  - pajak
  - anggaran (fase 9)
  - kredensial E-Klaim per RS (fase 7)
- **Fase 6:** titik perluasan disiapkan (`payment_intent_id`, enum metode, `refunds`, klaim `payable`).
- **ID fixture bernama pasien dan drift demo** → 5.0c + E2E demo.

## 6. Definisi selesai fase 5 → potongan

| Kriteria                                                                                                  | Potongan                                   |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Setiap layanan klinis menghasilkan baris tagihan dengan sumbernya; kasir tidak menambah item tanpa alasan | 5.0b, 5.1a, 5.2, 5.4, 5.7, 5.12            |
| Setiap transaksi uang menghasilkan jurnal seimbang (tes properti)                                         | 5.0b, 5.3, 5.6, 5.7, 5.8, 5.10, 5.11, 5.12 |
| Klaim berjalan: koding → grouper (mock) → final → kirim → status                                          | 5.1b, 5.1c, 5.5, 5.10, 5.12                |
| Periode tertutup tidak bisa diubah                                                                        | 5.0b, 5.3, 5.11, 5.12                      |
| Aturan umum: migrasi, seed, tes izin + isolasi, audit, teks Indonesia, lint/typecheck/test hijau          | setiap potongan; diperiksa di 5.12         |

---

### Berkas paling penting untuk implementasi

- /Users/godam/PROYEK/simrs/packages/shared/src/authz.ts (katalog izin + matriks), bersama `numbering.ts`, `settings.ts`, `schemas/penunjang.ts`, `schemas/keuangan.ts`, `schemas/btn.ts`
- /Users/godam/PROYEK/simrs/packages/db/prisma/schema.prisma (beserta folder migrations)
- /Users/godam/PROYEK/simrs/apps/worker/src/outbox/operations.ts (operasi E-Klaim; pemroses inbound dan konsumen event baru di sebelahnya)
- /Users/godam/PROYEK/simrs/apps/web/src/lib/screens.ts (beserta `lib/server/data/penunjang.ts` dan `lib/server/data/keuangan.ts`)
- /Users/godam/PROYEK/simrs/apps/mock/src/systems/eklaim.ts (beserta `lis.ts` yang baru dan endpoint mutasi di `btn.ts`)
