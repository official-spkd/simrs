# Rencana fase 6 · Pembayaran TPDI × BTN dan pembiayaan BTN

Disusun 5 Okt 2026 oleh agen Q (hanya baca, tidak ada berkas yang diubah). Pemilik produk sudah menyetujui lebih dulu: untuk setiap keputusan terbuka dipilih opsi yang paling baku, aman, dan sederhana, ditandai **(keputusan diambil, disetujui otomatis 5 Okt 2026)**.

**Nomor ADR:**

- Blok 0046–0050 untuk fase 6 (dinomori ulang penggabung; 0034–0045 untuk fase 4–5; 0033 = batas laju Redis).
- Blok 0051–0057 untuk fase 7.
- 0028–0032 dipakai fase 3; 0060 ke atas dipakai fase 8–10.
- **(keputusan diambil, disetujui otomatis 5 Okt 2026)**

## 1. Ringkasan

Fase 6 membangun backend nyata untuk tiga hal berikut.

**I05 (bagian bank/TPDI) + U03 kanal digital:**

- Payment intent VA BTN dan QRIS lewat TPDI.
- Settlement EDC BTN.
- Webhook TPDI (HMAC, idempoten) dan kedaluwarsa tagihan.
- Refund 2 tingkat.
- Kirim tagihan ke WhatsApp. Aplikasi pasien masih stub.

**U09 rekonsiliasi 3 arah:**

- Kasir SIM RS ↔ laporan TPDI ↔ mutasi BTN H2H.
- Layar pengecualian.
- Pengunci tutup periode.

**U04 pembiayaan BTN:**

- Piutang klaim BPJS: pool, pencairan (drawdown) dibatasi plafon dan advance rate, pelunasan otomatis saat BPJS membayar, jurnal.
- Cicilan pasien: mesin status, persetujuan pembukaan data (UU PDP), pencairan → tagihan lunas.

Layar yang disambungkan ke API (`DATA_SOURCE=api`):

- `/keuangan/pembayaran`
- `/keuangan/pembiayaan`
- kanal baru di `/keuangan/kasir` (layar milik fase 5)

Jalur demo dipertahankan, dibekukan, dan tetap diuji E2E demo (pola keputusan fase 2 #4).

Urutan pengerjaan:

1. Kontrak dan skema DB.
2. Fondasi web hybrid dan mock TPDI/BTN lengkap.
3. Penerima webhook, konektor, dan pemroses inbound di worker.
4. Domain paralel: intent/kasir, sumber rekonsiliasi, pembiayaan piutang, cicilan.
5. Refund, mesin rekonsiliasi, konfigurasi.
6. Penutup dengan E2E DoD.

Prinsip pengikat:

- **Dana tidak transit di TPDI (ADR-0005).**
  - Setiap tagihan TPDI membawa rekening tujuan = rekening operasional RS di BTN.
  - Jawaban TPDI wajib menggemakan rekening yang sama. Bila beda: galat permanen + alarm.
  - Refund didebit dari rekening RS.
- **BTN/TPDI adalah sumber kebenaran fakta bank:** nominal masuk, margin terdebit, status kredit. SIM RS mencatat, menjurnal, dan merekonsiliasi; tidak memutuskan status kredit.
- **Setiap mutasi uang menjurnal** lewat API jurnal fase 5: seimbang, idempoten per sumber.

### 1.1 Prasyarat dan antarmuka yang dibutuhkan

**Dari fase 2 (rencana disetujui):**

- **1a:**
  - Seam konektor per tujuan di worker.
  - Kebijakan retry per operasi.
  - Hasil `{ defer }` yang tidak menghabiskan percobaan dan punya batas umur.
  - Registri `onDead`.
  - P11 job berkala per tenant.
- **1b:**
  - Publisher event domain yang menjalankan listener di dalam transaksi permintaan, supaya outbox ikut atomik.
  - SSE (ADR-0026) untuk status intent di Kasir.
- **0c:** `requireScreen(id)` dan pola `demo-*.tsx`.
- **1d:** E2E dengan mock + worker, helper skenario mock, reset mock.
- **Keputusan #8:** WhatsApp ke pasien lewat outbox; dipakai ulang untuk "kirim tagihan".

**Dari fase 5 (direncanakan paralel; wajib ada sebelum gelombang C):**

1. `invoices` + query `patientDue` dengan kunci baris (`FOR UPDATE`), supaya dua kanal tidak melunasi tagihan yang sama dua kali. Status `final`/`lunas`.
2. `deposits` (uang muka per encounter) dan `payments`:
   - metode: `va_btn`, `qris_btn`, `edc_btn`, `tunai`, `financing_btn`;
   - kolom `payment_intent_id` (unik, nullable) dan `reference`.
3. **Fungsi bertransaksi, bukan hanya service Nest**, yang bisa dipanggil API dan worker di transaksi pemanggil. Letaknya di `packages/db` atau paket domain bersama yang disepakati.
   - `recordPayment(tx, { invoiceId | depositId, method, amount, paidAt, reference, paymentIntentId? })`
     - membuat `payments` + jurnal;
     - idempoten per intent/referensi.
   - `postJournal(tx, { sourceType, sourceId, eventKey, date, lines: [{ accountKey, debit, credit }] })`
     - wajib seimbang;
     - idempoten per `(sourceType, sourceId, eventKey)`;
     - menolak periode tertutup dengan `PERIOD_CLOSED`.
   - `recordBpjsClaimPayment(tx, { claimBatchId, amount, paidAt, bankStatementLineId })`
     - jurnal D Bank penampungan / K Piutang BPJS;
     - klaim → `paid`.
   - Bila fungsi ini hanya ada di `apps/api`, potongan 6.1b mengekstraknya bersama agen fase 5. Logika jurnal tidak boleh digandakan.
4. Pemetaan akun per kunci (`coa_account_mappings`). Kunci minimal:
   - `bank.btn.operational`, `bank.btn.claim_escrow`
   - `liability.patient_deposit`, `ar.patient`, `ar.bpjs`
   - `liability.financing_btn`, `expense.financing_margin`, `expense.bank_fee`
   - `suspense.unidentified_receipt`, `suspense.payment_difference`
5. `bank_accounts` dan `bank_statement_lines`.
   - `bank_accounts`: jenis `operational`/`claim_escrow`, nomor terenkripsi + 4 digit tersamar, akun COA.
   - `bank_statement_lines`: append-only, unik per `(bank_account_id, bank_ref)`.
   - Bila belum ada saat 6.0b, fase 6 membuatnya dengan bentuk ini dan fase 5 memakainya.
6. Titik registrasi pengunci tutup periode: `registerPeriodCloseBlocker(name, fn)`.
7. Klaim berkelompok: `claim_batches`.
   - Kolom: bulan pelayanan, jenis RJ/RI, jumlah berkas, nilai layak bayar (bigint), nomor + tanggal BA verifikasi, status `payable|pending|dispute|paid`.
   - Event: `claim.batch_payable`, `claim.batch_disputed`, `claim.batch_paid`.
   - Mockup memakai pool per batch.
8. `refunds` (docs/04: "persetujuan bertingkat"):
   - bila fase 5 sudah membuatnya untuk tunai, fase 6 menambah kanal digital + eksekusi TPDI;
   - bila belum, 6.0b membuatnya dan fase 5 memakainya.
9. Kasir tersambung API, dengan titik sisip kanal digital di `apps/web/src/components/keuangan/payment-methods.tsx` dan `payment-panel.tsx`.

**Dari fase 4:** skema kamar operasi saat ini menumpang di `packages/shared/src/schemas/btn.ts` dan `apps/web/src/lib/server/data/btn.ts`. Fase 6 memecahnya (lihat 6.0a/6.0c); OR menjadi milik fase 4.

## 2. Potongan kerja (urut dependensi)

**Aturan umum tabel baru:**

- `tenant_id` + RLS `FORCE` dengan `app_current_tenant()`.
- FK komposit `(tenant_id, id)`; migrasi FK dibungkus `NO FORCE`/`FORCE`.
- Uang `bigint` + CHECK.
- Tanpa DELETE: REVOKE + trigger `app_reject_mutation` untuk tabel append-only.
- `schema-guard.test.ts` diperbarui.
- Migrasi memakai blok cap waktu per potongan, setelah migrasi terakhir fase 5.

### 6.0a · Kontrak bersama (`packages/shared`)

Komponen: I05, U03, U04, U09.

**Katalog izin:**

- `payment` (read, write)
- `payment.config` (read, write)
- `payment.refund` (request, approve, authorize)
- `reconciliation` (read, run, resolve)
- `financing.receivable` (read, request, configure)
- `financing.instalment` (read, write)

**Matriks bawaan:**

- kasir: `payment.*` read/write, `payment.refund.request`, `financing.instalment` read/write.
- akuntan: `payment.read`, `payment.config.read`, `payment.refund.approve`, `reconciliation` read/run/resolve, `financing.receivable` read/request, `financing.instalment.read`.
- manajemen: `payment.read`, `payment.refund.authorize`, `reconciliation.read`, `financing.receivable` read/configure, `financing.instalment.read`.
- admin_tenant: `payment.config` read/write.

**Penomoran:**

- `refund` → `RF-YYMM-NNNN`
- `financing_drawdown` → `PCR-YYMM-NN`
- `instalment_application` → `PB-YYMM-NNNN`
- `payment_bill` (`INV-DP-…`) sudah ada.

**Pengaturan tenant** (menutup utang literal margin 11%):

| Kunci                                      | Bawaan                |
| ------------------------------------------ | --------------------- |
| `payments.channels`                        | —                     |
| `payments.va_expiry_hours`                 | 24 (pilihan 12/24/48) |
| `payments.qris_expiry_minutes`             | 10 (pilihan 5/10/15)  |
| `payments.expiry_grace_minutes`            | 2                     |
| `recon.settlement_window_days`             | 2                     |
| `recon.auto_run_time`                      | 01:00 WIB             |
| `financing.instalment_enabled`             | —                     |
| `financing.instalment_tenors`              | [3, 6, 12]            |
| `financing.instalment_margin_pct_estimate` | —                     |

**Konstanta:**

- Operasi outbox:
  - `tpdi.invoice.create|cancel|status`, `tpdi.refund.create`, `tpdi.report.pull`, `tpdi.webhook_secret.rotate`
  - `btn.statement.pull`, `btn.instalment.submit|cancel`, `btn.drawdown.request|cancel`
- Sumber dan jenis inbound:
  - TPDI: `payment.paid|expired|failed`, `refund.completed`
  - BTN: `instalment.*`, `drawdown.*`, `repayment.completed`
- Event domain: `payment_intent.updated`, `payment.recorded`, `refund.completed`.

**Kontrak zod:**

- `integrations/tpdi/contract.ts`: invoice create/cancel/status, laporan, refund, body webhook.
- `integrations/btn/contract.ts`: mutasi berpaginasi kursor, cicilan, drawdown, body webhook + header `X-BTN-Event-Id/Timestamp/Signature`.
- `integrations/webhook-hmac.ts`: verifikator generik turunan `tpdi-signature.ts`; menerima beberapa secret kandidat dan mengembalikan versi kunci yang cocok.
- Uang di batas eksternal = integer aman lewat `toSafeIntegerRupiah` (tolak > 2^53−1).

**Aturan murni dipindah** dari `apps/web/src/lib/btn.ts` dan `apps/web/src/lib/btn-pembiayaan.ts` ke `packages/shared/src/payments/*` dan `packages/shared/src/financing/*`:

- idempotensi webhook;
- mesin status intent/refund/cicilan/drawdown;
- `reconcile3Way`, `advanceAmount`, `marginFor`, `repaymentSplit`, `monthlyInstalment`, `drawdownRequestError`.

Web mengekspor ulang; label tampilan tetap di web.

**Revisi skema `schemas/btn.ts`:**

- Dipecah menjadi `schemas/payments.ts` dan `schemas/financing.ts`. OR pindah ke `schemas/surgery.ts` (milik fase 4); `btn.ts` mengekspor ulang sementara.
- `.min(1)` pada daftar dilonggarkan, karena data nyata bisa kosong.
- ID = UUID, ditambah kolom `number` (mis. drawdown `PCR-…` bukan lagi ID).
- Status DB (Inggris) ↔ label layar dipetakan di satu fungsi.

**Tes:**

- Unit aturan.
- Uji properti berbasis generator ber-seed, tanpa dependensi baru:
  - `reconcile3Way`: setiap transaksi masuk tepat satu kategori; total per sisi = jumlah baris;
  - transisi terlarang ditolak;
  - nilai golden mockup tetap: Rp 6.426.000 / Rp 6.455.600 / Rp 684.400.

**DoD:** semua kriteria (fondasi).

### 6.0b · Skema DB + migrasi + seed (`packages/db`), setelah 6.0a

**Integrasi dan pembayaran:**

- **`integration_connections`** (unik per tenant × sistem; dipakai ulang fase 7)
  - Kolom: `system`, `mode` (sandbox|production), `account_ref` (merchant ID TPDI / partner ID BTN), `enabled`, `settlement_account_id`, kolom jejak.
  - Base URL **tidak** disimpan per tenant: diambil dari env per mode untuk mencegah SSRF.
- **`integration_secrets`**
  - Kolom: `system`, `name`, `version`, `ciphertext`, `fingerprint`, `status`, `valid_until`, `expires_at`, `created_by`, `activated_at`.
  - `ciphertext`: AES-256-GCM dengan kunci terpisah `INTEGRATION_SECRET_KEY`; AAD = tenant|sistem|nama|versi.
  - `fingerprint`: 4 karakter terakhir.
  - `status`: pending|active|previous|revoked.
  - Indeks unik parsial: satu `active` per (tenant, sistem, nama).
  - Trigger: ciphertext/nama/versi beku; status hanya maju.
- **`payment_intents`**
  - Kolom: `number`, `purpose` (deposit|invoice), `invoice_id?`, `deposit_id?`, `encounter_id`, `patient_id`, `channel` (va|qris), `amount > 0`.
  - `status`: draft|pending|paid|amount_mismatch|expired|failed|cancelled|refund_requested|partially_refunded|refunded.
  - Kolom TPDI/bank: `tpdi_invoice_id` (unik), `va_number`, `qr_payload`, `expires_at`, `paid_at`, `paid_amount`, `bank_ref`, `settlement_account_last4`, `failure_code`.
  - Kolom kontrol: `cancel_reason`, `version`.
  - CHECK purpose ↔ FK.
  - Unik parsial `(tenant_id, invoice_id) WHERE status IN ('draft','pending')`.
  - Trigger `app_payment_intent_guard`:
    - identitas, nominal, dan kanal beku;
    - transisi status hanya menurut tabel transisi. Tabel ini sama dengan `packages/shared` dan dijaga tes kesetaraan.
- **`payment_events`** (append-only)
  - Kolom: `intent_id`, `inbound_event_id` (unik), `kind`, `amount`, `bank_ref`, `occurred_at`.
  - `outcome`: applied|duplicate|amount_mismatch|late|unmatched.
- **`webhook_rejections`** (append-only)
  - Kolom: `source`, `reason` (SIGNATURE_INVALID|TIMESTAMP_EXPIRED|MERCHANT_MISMATCH|MALFORMED), `event_id_header` (≤100), `remote_ip`, `body_sha256`.
  - **Tanpa body.**
- **`inbound_events`** (ubah)
  - Kolom baru: `event_type`, `attempts`, `next_attempt_at`, `dead_at`, `key_version`.
  - `raw_body`/`headers` beku lewat trigger.
  - REVOKE DELETE.
- **`refunds` + `refund_approvals`** (bila belum ada dari fase 5)
  - `refunds`: `number`, `payment_id`/`intent_id`, `channel`, `amount`, `reason`, `note`, `requested_by`, `tpdi_refund_id`.
  - `refunds.status`: draft|pending_l1|pending_l2|processing|awaiting_manual|completed|rejected|failed.
  - Trigger: amount ≤ dibayar − sudah direfund.
  - `refund_approvals`: append-only (level, decided_by, decision, note).
  - Trigger: L1 ≠ pemohon; L2 ∉ {pemohon, L1}.

**Rekonsiliasi:**

- **`edc_settlement_batches`**: terminal, batch_no (unik per terminal), closed_at, amount, count, entered_by. Beku; koreksi = batal beralasan + baris baru.
- **`tpdi_report_lines`** (append-only): unik per (tenant, tpdi_invoice_id, report_date).
- **`bank_statement_lines`**: bila dibuat di sini, ditambah `source` (h2h|manual), `pull_message_id`, `direction`.
- **`recon_runs`**: business_date (WIB), run_no, status, triggered_by, totals bigint, counts.
- **`recon_items`** (append-only per run)
  - `category`: matched|matched_heuristic|pending_settlement|only_kasir|only_tpdi|only_bank|amount_mismatch.
  - FK ke payment/intent/tpdi_line/bank_line/edc_batch, nominal tiap sisi.
- **`recon_exceptions`**: identitas stabil antar-run, unik (tenant, kind, subject_key). Status open|resolved. Kolom resolusi (aksi, catatan, pelaku, waktu, journal_entry_id) diisi sekali lalu beku.

**Pembiayaan:**

- **`financing_facilities`**
  - Kolom: agreement_no, limit, advance_rate_bps (1–10000), margin_bps (0–5000), max_tenor_days, valid_from/to, rekening operasional/penampungan, status (draft|active|ended), supersedes_id.
  - Beku setelah `active`; amandemen = baris baru.
  - Satu `active` per tenant.
- **`financing_drawdowns`**
  - Kolom: number, facility_id, requested/disbursed/outstanding principal, requested_by, internal_approved_by (CHECK ≠ requested_by), btn_ref, disbursed_at, due_at, settled_at.
  - `status`: requested|approved_internal|sent|approved_btn|disbursed|settled|rejected|cancelled|failed.
- **`financing_pledges`**
  - Kolom: drawdown × claim_batch, snapshot claim_amount.
  - Unik parsial `(tenant_id, claim_batch_id) WHERE released_at IS NULL`.
- **Trigger plafon dan advance** pada drawdown + pledge:
  - mengambil `pg_advisory_xact_lock` per fasilitas;
  - memeriksa Σ outstanding aktif ≤ limit;
  - memeriksa principal ≤ floor(Σ klaim × rate / 10000);
  - dicek ulang lewat constraint trigger DEFERRABLE saat commit.
- **`financing_repayments`** (append-only)
  - Kolom: btn_event_id (unik), bpjs_paid, principal, margin, forwarded, value_date, escrow_line_id, margin_estimate, difference.
- **`patient_financing_applications`**
  - Kolom: number, patient_id, invoice_id, encounter_id, amount, tenor_months, source (cashier|patient_app), consent_id, btn_application_id, reject_reason, disbursed_amount, payment_id.
  - `consent_id` → `privacy_consents` jenis `pembukaan_data`, penerima BTN.
  - `status`: submitted|btn_verifying|approved|contract_signed|disbursed|rejected|cancelled|failed.
  - Nominal dan tenor beku setelah diajukan.
- **`patient_financing_events`** (append-only).

**Lain-lain:**

- Tidak ada fungsi `SECURITY DEFINER` baru: tenant webhook ditentukan dari kode RS di path, lewat `app_resolve_tenant_by_code` yang sudah ada.
- Migrasi data izin baru ke peran RS yang sudah berjalan (utang P03).
- Seed:
  - koneksi TPDI/BTN per tenant dengan merchant berbeda (RSCM, RSFA, RSFB);
  - secret lokal dari env, terenkripsi;
  - rekening fiktif ••••4417 / ••••9021;
  - fasilitas fiktif `0127/PKS-PB/BTN-RS/VIII/2026`;
  - batch klaim contoh bila seed fase 5 ada.

**Tes db:**

- Isolasi RLS semua tabel, FORCE terpasang.
- Append-only, termasuk bagi pemilik tabel.
- Penjaga transisi intent.
- Satu intent menunggu per tagihan.
- Penyetuju refund berbeda; nominal refund ≤ sisa.
- Satu secret aktif; ciphertext beku.
- Pledge ganda ditolak.
- **20 pengajuan pencairan serentak untuk sisa plafon → jumlah yang lolos ≤ plafon.**

**DoD:** pencairan dibatasi plafon dan advance rate.

### 6.0c · Fondasi web hybrid (paralel dengan 6.0b)

- `apps/web/src/lib/server/data/btn.ts` dipecah menjadi `payments.ts` dan `financing.ts`. OR pindah ke `surgery.ts`, dikoordinasikan dengan fase 4.
- `app/(staf)/keuangan/pembayaran/page.tsx` dan `pembiayaan/page.tsx` memakai `requireScreen(...)`:
  - jalur demo pindah ke `demo-pembayaran.tsx` / `demo-pembiayaan.tsx`, membungkus `pembayaran-client.tsx`, `use-payment-state.ts`, `pembiayaan-client.tsx`, `use-financing-state.ts` tanpa perubahan;
  - jalur api ke `api-*.tsx` (kerangka).
- `actions.ts` dipecah menjadi `demo-actions.ts` + `actions.ts`.
- `lib/btn*.ts` mengimpor aturan dari shared.
- Tes: unit `rsc-boundary`; E2E demo `apps/web/e2e/demo/btn.spec.ts`, `keuangan.spec.ts`, `semua-layar.spec.ts` tetap hijau.

### 6.0d · Mock TPDI × BTN lengkap (`apps/mock`, paralel)

**TPDI** (`apps/mock/src/systems/tpdi.ts`):

- **Registri merchant per tenant** (`TPDI_MERCHANTS`, bawaan 3 RS): api key, secret webhook (aktif + lama), target `…/api/v1/webhooks/tpdi/<KODE_RS>`, rekening settlement.
- **Invoice:**
  - `POST /invoices` memvalidasi dan menggemakan `settlement_account`;
  - `POST /invoices/:id/cancel`.
- **Webhook otomatis saat bayar**, dengan retry TPDI 5× (dipercepat di mock).
- **Panel:**
  - bayar pas;
  - bayar nominal beda (`amountOverride`, kini diabaikan, diimplementasikan);
  - kirim ulang (event id sama);
  - tanda tangan salah;
  - timestamp kedaluwarsa;
  - bayar tanpa webhook (uji polling);
  - kedaluwarsakan;
  - gagal.
- **Laporan** per tanggal WIB untuk semua status.
- **Refund:** idempoten, ≤ sisa → `refund.completed` + debit BTN.
- **Rotasi secret:** `POST /merchants/webhook-secret`; secret lama berlaku 24 jam.

**BTN** (`apps/mock/src/systems/btn.ts`):

- **Buku besar per rekening.** Isinya:
  - kredit invoice lunas;
  - settlement batch EDC;
  - biaya VA/MDR sebagai debit terpisah;
  - debit refund;
  - kredit BPJS ke penampungan;
  - auto-debit;
  - penerusan sisa;
  - "unggah mutasi" (kredit tak dikenal).
- `GET /accounts/:no/statements?from&to&cursor`.
- **Cicilan pasien:**
  - pengajuan (idempoten) dan batal;
  - panel verifikasi/setujui/akad/cairkan/tolak → webhook + kredit operasional.
- **Drawdown:**
  - plafon dicek juga di sisi BTN;
  - panel setujui/tolak/cairkan.
- **Panel "BPJS bayar klaim":** kredit penampungan → auto-debit pokok + margin (hari aktual) → teruskan sisa → webhook `repayment.completed`.
- Webhook ditandatangani `X-BTN-*`.
- Reset dan helper E2E.

**Tes mock:** idempotensi, tanda tangan, aritmetika auto-debit, konsistensi mutasi, isolasi antar-merchant.

**DoD:** webhook ganda, tanda tangan, nominal beda, rekonsiliasi, pembiayaan (sebagai alat uji).

### 6.1a · Penerima webhook + layanan kredensial (`apps/api/src/modules/webhooks/`)

**Rute:** `POST /api/v1/webhooks/tpdi/:tenantCode` dan `POST /api/v1/webhooks/btn/:tenantCode`.

- Controller tanpa AuthGuard dan tanpa `@TenantScoped`, seperti `SignatureVerificationController`.

**Pembacaan body:**

- Middleware raw-body (pola `common/raw-upload.middleware.ts`): JSON maksimal 64 KB, dibaca sebelum transaksi.

**Urutan verifikasi:**

1. Tenant dari `app_resolve_tenant_by_code`. Hanya tenant `hospital` aktif.
2. Secret kandidat (active + pending + previous yang masih berlaku) didekripsi lewat `IntegrationSecretsService` di `packages/db` + kripto `@simrs/shared/node`.
3. Timestamp ±5 menit.
4. HMAC timing-safe.
5. Parse zod.
6. `merchant_id`/`partner_id` harus = `account_ref`.

**Hasil:**

- Sah → `INSERT … ON CONFLICT DO NOTHING` ke `inbound_events`, lalu 200 `{ received: true, duplicate }`.
- Ditolak → baris `webhook_rejections` di transaksi pendek terpisah, lalu **401 seragam `WEBHOOK_UNAUTHENTICATED`**.
- Penolakan **tidak menempati** idempotency key.

**Pengaman lain:**

- Throttler `webhook` per IP dan per kode RS.
- Tanpa pemrosesan domain di endpoint.
- Tanpa PHI di log.

**Env baru:** `INTEGRATION_SECRET_KEY` di API + worker (`envSchemas.integrationSecrets`).

**Tes:** `apps/api/test/webhooks-tpdi.test.ts`, `webhooks-btn.test.ts`:

- sah → 1 baris;
- event id sama 2× berurutan dan 10× serentak → 1 baris;
- tanda tangan salah, timestamp lalu/masa depan, merchant salah, kode RS tak dikenal, kode tenant PLATFORM → 401, tanpa baris inbound;
- event id yang pernah ditolak lalu dikirim sah → diterima;
- secret lama < 24 jam diterima, > 24 jam 401;
- body > 64 KB → 413;
- body bertanda tangan RSFA dikirim ke URL RSFB → 401;
- 429.

**DoD:** webhook ganda; tanda tangan salah/kedaluwarsa.

### 6.1b · Worker: konektor TPDI/BTN, pemroses inbound, penerapan pembayaran

**Konektor** (di atas seam fase 2):

- `tpdi`: `X-API-Key` per tenant, base URL `TPDI_BASE_URL` per mode.
- `btn`: client credentials; mTLS lewat undici Agent bila sertifikat ada (placeholder).

**Pemroses inbound** (`apps/worker/src/inbound/inbound.processor.ts`):

- Per tenant aktif, klaim dengan SKIP LOCKED + lease.
- Peta `INBOUND_HANDLERS` (Map, seperti `OUTBOX_OPERATIONS`).
- Handler dan status `processed` berjalan dalam satu transaksi.
- Galat sementara → backoff; event tak dikenal → `ignored`; permanen → `dead` (terlihat di hub fase 7).

**Fungsi bersama** `packages/db/src/payments/apply.ts` (`applyTpdiPaid`, `applyTpdiExpired`, …), dipakai handler dan operasi polling:

| Kasus                              | Penanganan                                                                                                                                            |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nominal cocok                      | intent `paid` + `payment_events(applied)` + `recordPayment`/deposit (D Bank operasional / K uang muka atau piutang) + audit `system` + notifikasi SSE |
| Nominal beda                       | `amount_mismatch` + jurnal D Bank / K `suspense.payment_difference` + pengecualian; **tidak lunas**                                                   |
| Intent sudah lunas oleh event lain | `duplicate`, tanpa efek                                                                                                                               |
| Bayar setelah kedaluwarsa/batal    | diterapkan bila tagihan masih terutang; bila tidak → titipan + pengecualian "pembayaran ganda"                                                        |
| Intent tidak ditemukan             | `unmatched`, muncul lagi lewat laporan TPDI                                                                                                           |

**`onDead`:** `tpdi.invoice.create` → intent `failed` (`TPDI_UNAVAILABLE`) + SSE.

**Tes:** `apps/worker/test/inbound.test.ts`, `tpdi.test.ts`:

- dua event id berbeda untuk satu tagihan → 1 pembayaran, 1 jurnal;
- 2 baris inbound diproses serentak → 1 pembayaran;
- nominal beda → tanpa pembayaran, jurnal titipan seimbang;
- bayar telat;
- tebakan `tpdi_invoice_id` RSFB dari event RSFA tidak berefek;
- `recordPayment` gagal → status ikut batal;
- properti jurnal seimbang.

**DoD:** webhook ganda; nominal beda.

### 6.2 · Payment intent + kanal digital di Kasir

**API** `apps/api/src/modules/payments/`, semua di bawah `/api/v1/payments`:

| Endpoint                                   | Izin            |
| ------------------------------------------ | --------------- |
| `GET overview?date`                        | `payment.read`  |
| `GET intents?channel&status&q&date&cursor` | `payment.read`  |
| `GET intents/:id`                          | `payment.read`  |
| `POST intents` (header Idempotency-Key)    | `payment.write` |
| `POST intents/:id/cancel`                  | `payment.write` |
| `POST intents/:id/send`                    | `payment.write` |
| `POST intents/:id/refresh-status`          | `payment.write` |

- `overview` berisi KPI hari WIB, webhook terakhir, p95 proses webhook, dan tarikan bank terakhir.
- Audit:
  - daftar = `search` per pasien (pola ADR-0015);
  - detail = `read`;
  - mutasi = `create`/`update` dengan `patientId`.

**Aturan pembuatan intent:**

- Nominal dihitung server dari `patientDue` (baris tagihan dikunci). Nominal dari klien diabaikan.
- Kanal harus aktif dan rekening settlement harus aktif.
- Nomor dari layanan penomoran.
- Intent dibuat `draft` + outbox `tpdi.invoice.create` dengan payload `{intentId}`.

**Operasi worker:**

- `tpdi.invoice.create`:
  - body tanpa PHI: `external_ref` = UUID intent, deskripsi "Tagihan <kode RS>";
  - `onSuccess` memverifikasi gema rekening, menyimpan VA/QR, lalu → `pending`.
- `tpdi.invoice.cancel`: bila TPDI menjawab 409 karena sudah dibayar, webhook yang menang.
- Kirim WhatsApp: `notify.patient.whatsapp`, templat `tagihan_pembayaran` (VA, nominal, batas waktu), maksimal 3× per intent.
- Job P11 "sapu kedaluwarsa" tiap 5 menit: intent menunggu yang lewat `expires_at` + 2 menit → `tpdi.invoice.status`.
- SSE: kanal `payments`, event `payment_intent.updated {id}`.

**Web:**

- `app/(staf)/keuangan/pembayaran/api-pembayaran.tsx`, tab Transaksi. Memakai ulang:
  - `components/btn/transaksi-tab.tsx`
  - `components/btn/transaksi-detail.tsx`: jejak dari `payment_events`, daftar webhook + penolakan
  - `components/btn/money-flow.tsx`
- Tombol "Simulasikan pembayaran" hanya di demo. Di api + lokal diganti tautan ke panel mock.
- Kasir: `components/keuangan/payment-methods.tsx`, `payment-panel.tsx`, `components/btn/deposit-controls.tsx`:
  - buat VA/QRIS;
  - tampilkan nomor VA / QR;
  - status hidup lewat EventSource BFF;
  - batal dan kirim WhatsApp.
  - EDC tetap manual (fase 5).
- `lib/server/data/payments.ts` jalur api.

**Tes:** `apps/api/test/payments.test.ts`:

- 403 untuk perawat/akuntan saat membuat intent;
- tagihan RSFB → 404;
- nominal klien diabaikan;
- intent kedua → 409 `PAYMENT_INTENT_EXISTS`;
- Idempotency-Key diulang → intent yang sama;
- kanal mati → 422;
- audit memuat `patientId`.

Tes worker: gema rekening beda → DLQ; webhook hilang → lunas lewat polling tepat sekali.

**DoD:** webhook ganda; nominal beda.

### 6.3 · Sumber rekonsiliasi: mutasi BTN H2H, laporan TPDI, settlement EDC

**Operasi outbox** (terjadwal P11, terlihat di hub):

- `btn.statement.pull`
  - per rekening, jendela [kursor, sekarang];
  - kunci `btn-pull:<akun>:<awal-jendela>`;
  - `onSuccess` memasukkan baris `ON CONFLICT DO NOTHING` per `bank_ref` dan memajukan kursor;
  - tiap 5 menit.
- `tpdi.report.pull`: harian 00.30 WIB untuk D−1, dan sesuai permintaan.

**Settlement EDC:**

- `POST/GET /api/v1/reconciliation/edc-batches` (`payment.write`, kasir).
- Form "Catat settlement EDC" di tab Rekonsiliasi.

**Rekening penampungan** menjadi masukan 6.4 dan pengakuan pembayaran klaim fase 5.

**Tes:**

- jendela sama 2× / tumpang tindih → tanpa duplikat;
- baris mutasi beku;
- batas tanggal WIB (23.59/00.01);
- kredensial per tenant;
- RSFB tidak bisa menarik rekening RSFA.

**DoD:** rekonsiliasi 3 sumber.

### 6.4 · Pembiayaan piutang BPJS (U04)

**API** `apps/api/src/modules/financing/`, di bawah `/api/v1/financing`:

| Endpoint                           | Izin / catatan                                                                                             |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `GET facility`                     | read                                                                                                       |
| `POST facilities` (+ aktivasi)     | `configure`                                                                                                |
| `GET pool`                         | batch layak dari fase 5 + status pledge                                                                    |
| `POST drawdowns/quote`             | —                                                                                                          |
| `POST drawdowns` (Idempotency-Key) | `request`                                                                                                  |
| `POST drawdowns/:id/approve`       | `configure`, pembuat ≠ penyetuju → outbox `btn.drawdown.request`                                           |
| `POST drawdowns/:id/cancel`        | —                                                                                                          |
| `GET drawdowns`                    | —                                                                                                          |
| `GET overview`                     | plafon, outstanding, sisa, margin berjalan (estimasi), rata-rata hari bayar BPJS, umur piutang dari fase 5 |

Audit untuk semua mutasi.

**Handler inbound:**

- `btn.drawdown.approved|rejected|disbursed`:
  - saat cair: nominal dari BTN;
  - jurnal D Bank operasional / K Utang pembiayaan;
  - outstanding = nominal cair.
- `btn.repayment.completed`:
  - `recordBpjsClaimPayment` bila belum diakui;
  - jurnal D Utang (pokok) + D Beban margin / K Bank penampungan;
  - jurnal D Bank operasional / K Bank penampungan (sisa);
  - outstanding dikurangi;
  - `settled` saat 0, pledge dilepas;
  - selisih margin BTN vs estimasi → pengecualian.

**Web:**

- `api-pembiayaan.tsx` tab A memakai ulang `components/btn/piutang-tab.tsx`, `piutang-pool.tsx`, `piutang-draws.tsx`, `piutang-aside.tsx`.
- Tombol sisi BTN dan "BPJS membayar klaim" hanya di demo. Di lokal api: tautan ke panel mock.
- `scenario-claim.tsx` hanya demo.

**Tes:** `apps/api/test/financing.test.ts`, `apps/worker/test/financing-repayment.test.ts`:

- quote = aritmetika shared;
- melebihi advance → 422 `FINANCING_ADVANCE_EXCEEDED`;
- melebihi plafon → 422 `FINANCING_LIMIT_EXCEEDED`;
- batch pending/dispute/paid/sudah di-pledge → 422;
- serentak (bersama db);
- pembuat = penyetuju → 409;
- jurnal pelunasan: akun dan nominal tepat, seimbang;
- pelunasan parsial;
- webhook BTN ganda → 1 pelunasan;
- batch RSFB → 404.

**DoD:** plafon/advance; pelunasan otomatis berjurnal benar.

### 6.5 · Cicilan biaya pasien

**API** `POST/GET /api/v1/financing/instalments`, `POST /:id/cancel` (`financing.instalment`):

- Syarat: tagihan final dan `patientDue` > 0.
- Persetujuan `pembukaan_data` penerima BTN dicatat lewat layanan persetujuan P05 di transaksi yang sama.
- Audit memuat `patientId`.

**Worker:**

- `btn.instalment.submit` (`sensitive`): data minimal (nama, NIK, HP didekripsi, nominal, tenor, no. tagihan). Persetujuan dicabut sebelum terkirim → `skip`, lalu `failed CONSENT_REVOKED`.
- `btn.instalment.cancel`.
- Handler `btn.instalment.*`: transisi status hanya dari BTN.
- Saat cair: `recordPayment(method financing_btn, nominal BTN)` → tagihan lunas. Nominal beda → pengecualian.

**Web:**

- Tab B: `components/btn/cicilan-tab.tsx`, `cicilan-detail.tsx`. Tombol tahap hanya demo; alasan tolak dari BTN.
- Kasir: `components/keuangan/cicilan-box.tsx` (estimasi `monthlyInstalment` + pengaturan, centang persetujuan + bukti).

**Tes:**

- tanpa persetujuan → 422 `CONSENT_REQUIRED`;
- field yang diterima mock = daftar minimal;
- tidak ada PHI di log;
- batal setelah keputusan BTN → 409;
- cair + webhook ganda → 1 pembayaran;
- isolasi tenant.

**DoD:** aturan umum + jurnal.

### 6.6 · Refund 2 tingkat

**API** di `/api/v1/payments/refunds`:

- `GET`, `GET :id`, `POST` (request), `POST :id/approve` (L1), `POST :id/authorize` (L2), `POST :id/reject` (catatan ≥ 10), `POST :id/record-manual` (EDC: kode approval pembalikan).
- Aturan dari shared (`refundDraftErrors`, `nextRefundStage`); DB menegakkan penyetuju berbeda.

**Eksekusi setelah L2:**

- VA/QRIS → outbox `tpdi.refund.create`.
- EDC → `awaiting_manual`.

**Penyelesaian:** handler `tpdi.refund.completed` → `completed` + jurnal per alasan:

- deposit: D Uang muka / K Bank;
- kelebihan/selisih: D Titipan / K Bank;
- lainnya: kunci akun fase 5 `refund.<alasan>`.

Intent → `refunded`/`partially_refunded`. Notifikasi in-app ke penyetuju (tanpa PHI).

**Web:** `components/btn/refund-tab.tsx`, `refund-form.tsx` jalur api.

**Tes:**

- pembuat = penyetuju ditolak di API dan DB;
- nominal > sisa → 422;
- Σ refund parsial ≤ dibayar;
- webhook refund ganda → 1 jurnal;
- 403 per tingkat;
- isolasi tenant;
- audit.

**DoD:** aturan umum (uang + jurnal).

### 6.7 · Rekonsiliasi 3 arah + layar

**Job `recon.run`** (worker, dalam transaksi tenant):

- Jadwal P11: 01.00 WIB untuk D−1 dan semua tanggal dalam jendela settlement. Juga sesuai permintaan (API 202).
- `reconcile3Way` (shared). Kunci pencocokan berurutan:
  1. `bank_ref`
  2. `tpdi_invoice_id`/`external_ref`
  3. nomor VA di deskripsi + nominal + tanggal → `matched_heuristic`, ditandai
- Hasil: run + item, upsert pengecualian stabil, menutup otomatis pengecualian yang sudah cocok (catatan sistem).

**API** `apps/api/src/modules/reconciliation/`:

- `GET days/:date`, `POST days/:date/run` (`reconciliation.run`), `GET exceptions`.
- `POST items/:id/resolve` (`reconciliation.resolve`, catatan ≥ 10, diaudit). Aksi:
  - **tautkan** → terapkan pembayaran + reklasifikasi dari titipan;
  - **koreksi** → jurnal penyesuaian;
  - **refund** → draf refund;
  - **eskalasi** → catatan, tetap terbuka;
  - **terima biaya** → jurnal biaya bank.
- Mendaftarkan pengunci tutup periode: pengecualian terbuka → `PERIOD_CLOSE_BLOCKED` alasan "rekonsiliasi".

**Web:** `components/btn/rekon-tab.tsx`, `rekon-exception.tsx` jalur api + KPI + tautan Akuntansi.

**Tes:** `apps/api/test/reconciliation.test.ts`, `apps/worker/test/recon-run.test.ts`:

- fixture tiap kategori: cocok, settlement menyusul lalu cocok, hanya kasir, hanya TPDI (webhook hilang), hanya bank, nominal beda, heuristik;
- total = jumlah;
- run ulang tanpa pengecualian ganda;
- resolusi berjurnal seimbang;
- tutup periode ditahan lalu lolos;
- batas WIB;
- isolasi tenant dan 403.

**DoD:** rekonsiliasi 3 sumber + selisih; nominal beda.

### 6.8 · Konfigurasi kanal + rotasi secret webhook

**API:**

- `GET/PUT /api/v1/payments/config`:
  - kanal, masa berlaku (lewat `tenant_settings`), mode sandbox/produksi (ditolak bila secret mode itu belum ada);
  - merchant ID hanya baca.
- `POST /api/v1/payments/config/webhook-secret/rotate`:
  - izin `payment.config.write` + **step-up TOTP** (layanan TOTP IAM, anti-replay);
  - membuat secret v+1 `pending` + outbox `tpdi.webhook_secret.rotate` (payload = ID versi; `prepare` mendekripsi);
  - `onSuccess`: baru → `active`, lama → `previous` berlaku 24 jam.

**Tampilan:** `whsec_••••abcd`.

**Web:** `components/btn/konfigurasi-tab.tsx` jalur api.

**Tes:**

- secret tidak pernah ada di respons, log, audit, atau payload outbox;
- tumpang tindih 24 jam;
- kode TOTP salah → 403 + audit;
- non-admin 403;
- isolasi tenant.

**DoD:** tanda tangan (rotasi).

### 6.9 · Penutup fase 6

**E2E api** `apps/web/e2e/pembayaran.spec.ts`, `pembiayaan.spec.ts`, meniru skenario elektif:

1. Deposit VA.
2. Panel mock: bayar → status hidup.
3. Kirim ulang webhook → tetap 1 pembayaran.
4. Tanda tangan salah → penolakan.
5. Nominal beda → pengecualian → tautkan → jurnal di Akuntansi.
6. Rekonsiliasi.
7. Refund oleh 3 akun berbeda → `refund.completed`.
8. Pencairan dalam plafon; tombol melebihi plafon nonaktif dan API 422.
9. BPJS bayar → jurnal pelunasan.
10. Cicilan → mock setujui/akad/cair → tagihan lunas.

**E2E TPDI mati:** intent → DLQ → `failed`, kasir beralih ke tunai.

**Lain-lain:**

- Review keamanan.
- ADR-0046…0050.
- Pembaruan docs: docs/07 (path per RS, status, webhook BTN), docs/04, docs/06 §6, panduan (pemroses inbound, kredensial).
- PROGRESS, QA visual.
- Regresi demo.
- `screens.ts` → `api`; `requires` menu = izin nyata.

## 3. Paralelisasi (maks. 4 agen sekaligus)

| Gelombang | Potongan              | Catatan           |
| --------- | --------------------- | ----------------- |
| A         | 6.0a                  | 1 agen, berurutan |
| B         | 6.0b ∥ 6.0c ∥ 6.0d    |                   |
| C         | 6.1a ∥ 6.1b           |                   |
| D         | 6.2 ∥ 6.3 ∥ 6.4 ∥ 6.5 |                   |
| E         | 6.6 ∥ 6.7 ∥ 6.8       |                   |
| F         | 6.9                   |                   |

**Kepemilikan berkas:**

- `schema.prisma` + migrasi: 6.0b saja. Potongan lain bila perlu memakai blok cap waktunya sendiri.
- Mock: 6.0d saja. Potongan lain hanya menambah berkas baru.
- `modules/webhooks/**`: 6.1a.
- `modules/payments/**`: 6.2 membuat; 6.6 menambah `refunds.*`; 6.8 menambah `payment-config.*`.
- `modules/reconciliation/**`: 6.3 menambah `edc-batches.*`; 6.7 menambah `reconciliation.*`.
- `modules/financing/**`: 6.4 `facility.*`/`drawdowns.*`; 6.5 `instalments.*`.
- Worker:
  - 6.1b membuat `inbound/` dan konektor;
  - setiap potongan menambah berkas operasi/handler/job sendiri dan **satu baris** di `OUTBOX_OPERATIONS`/`INBOUND_HANDLERS`/registri `onDead`.
- Web:
  - 6.0c membuat kerangka;
  - tab Transaksi + Kasir (`payment-methods.tsx`, `payment-panel.tsx`, `deposit-controls.tsx`) = 6.2;
  - `cicilan-box.tsx` + tab B = 6.5;
  - tab A = 6.4;
  - refund = 6.6;
  - rekonsiliasi = 6.7;
  - konfigurasi = 6.8.
- `PERMISSION_CATALOG`, `screens.ts`, `nav.ts`: satu baris per potongan.
- PROGRESS: hanya agen penggabung.

## 4. Keputusan (semua **(keputusan diambil, disetujui otomatis 5 Okt 2026)**)

1. **URL webhook per RS** (`/api/v1/webhooks/{tpdi|btn}/:tenantCode`); `merchant_id` di body harus cocok; galat 401 seragam. Tanpa fungsi SECURITY DEFINER baru. docs/07 diperbarui.
2. **Webhook yang ditolak** tidak menempati idempotency key; dicatat di `webhook_rejections` tanpa body.
3. **Rotasi secret webhook:** dibuat SIM RS, dikirim ke TPDI lewat outbox, step-up TOTP, secret lama berlaku 24 jam (sesuai mockup).
4. **Kredensial integrasi** di tabel khusus terenkripsi dengan kunci terpisah `INTEGRATION_SECRET_KEY`, bukan `tenant_settings`. Base URL dari env per mode (anti-SSRF). Dipakai ulang fase 7.
5. **Nominal webhook ≠ tagihan** → `amount_mismatch` + jurnal ke titipan selisih + pengecualian. Tidak pernah lunas otomatis.
6. **Bayar telat atau ganda diterima** (dana sudah di bank) → titipan/uang muka + pengecualian → refund.
7. **Satu intent menunggu per tagihan**; ganti kanal = batalkan dulu. **VA hanya closed amount** (pertanyaan docs/07 §7 no. 2 masih terbuka).
8. **Tanpa PHI ke TPDI.** `external_ref` = UUID intent; nama VA = nama RS.
9. **Polling status** (sapu kedaluwarsa + tombol "Periksa status") sebagai jaring pengaman webhook hilang.
10. **Refund:**
    - izin request/approve/authorize, bawaan kasir/akuntan/manajemen;
    - DB menegakkan 3 orang berbeda;
    - VA/QRIS lewat TPDI; EDC dicatat manual; tunai = fase 5.
11. **Rekonsiliasi:**
    - hari bisnis WIB;
    - jendela settlement 2 hari;
    - settlement **bruto** (biaya sebagai baris debit terpisah); mode neto = utang;
    - EDC dari batch settlement yang dicatat kasir;
    - pencocokan heuristik ditandai.
12. **Tutup periode ditahan** selama ada pengecualian rekonsiliasi terbuka.
13. **Status pembiayaan dari webhook BTN** (skema HMAC sama, header `X-BTN-*`). Uang dari mutasi H2H tiap 5 menit sebagai kebenaran.
14. **Pencairan butuh persetujuan internal** (pembuat akuntan ≠ penyetuju pemegang `configure`) sebelum dikirim ke BTN. Plafon dan advance ditegakkan DB dengan kunci advisory per fasilitas.
15. **Margin:**
    - diakui saat pelunasan memakai angka BTN; estimasi lokal hanya tampilan;
    - selisih → pengecualian;
    - akrual bulanan = utang (konfirmasi akuntan RS).
16. **Pelunasan parsial didukung**; drawdown selesai saat outstanding = 0.
17. **Cicilan:**
    - wajib persetujuan `pembukaan_data` ke BTN;
    - data minimal didekripsi di worker;
    - status hanya dari BTN;
    - RS boleh membatalkan sebelum BTN memutuskan;
    - sumber aplikasi pasien = fase 9.
18. **Gerbang fitur:**
    - pembayaran = modul `I05` + koneksi TPDI aktif;
    - piutang = ada fasilitas aktif;
    - cicilan = `financing.instalment_enabled`.
19. **Layar api menyembunyikan tombol sisi BTN/TPDI**; di lokal diganti tautan ke panel mock.
20. **Uji properti** memakai generator ber-seed; tanpa dependensi baru.
21. **Status intent di Kasir lewat SSE** (ADR-0026).
22. **Tarik mutasi/laporan lewat operasi outbox** terjadwal (retry/DLQ terlihat di hub).
23. **Blok nomor ADR** 0046–0050 (fase 6) / 0051–0057 (fase 7).

**ADR fase 6:**

- 0046 penerima webhook dan secret ganda
- 0047 kredensial integrasi per tenant
- 0048 status intent, selisih, dan polling
- 0049 rekonsiliasi 3 arah dan tutup periode
- 0050 pembiayaan: kebenaran BTN, plafon di DB, persetujuan data

## 5. Risiko dan utang

**Risiko:**

- **Konfirmasi hukum ADR-0005** (non-custodial) menjadi penghambat produksi.
- **Spesifikasi resmi TPDI/BTN belum ada** (docs/07 §7). Kontrak di shared hanya usulan dan diisolasi di konektor.
- **Antarmuka fase 5 terlambat** atau hanya berbentuk service Nest → 6.1b mengekstraknya.
- **Webhook:** hilang/badai/replay → polling, rate limit, toleransi waktu.
- **Lag settlement** T+1 → jendela 2 hari.
- **Netting biaya** oleh BTN.
- **Batas tanggal WIB vs DB UTC** (ADR-0014).
- **Bayar ganda lintas kanal** → kunci tagihan + titipan.
- **Klaim yang sudah dibiayai kemudian di-dispute BPJS.**
- **Deskripsi mutasi bank** bisa memuat nama pembayar → akses dibatasi akuntan, tidak masuk log.
- **Worker memegang `INTEGRATION_SECRET_KEY`** → perlakukan worker setara API.
- **State mock di memori** → reset di E2E.
- **OR menumpang di berkas BTN** → koordinasi dengan fase 4.

**Utang:**

- mode settlement neto;
- rekonsiliasi setoran tunai (bila fase 5 belum punya setoran kas);
- akrual margin bulanan;
- fee TPDI sebagai hutang usaha (U10);
- mTLS BTN nyata dan KMS/secret manager;
- lebih dari satu fasilitas per RS;
- cicilan dari aplikasi pasien (fase 9);
- penyempurnaan heuristik pencocokan;
- notifikasi tagihan ke aplikasi pasien.

**Utang yang ditutup:** literal margin cicilan 11% di web → pengaturan (6.0a).

## 6. Definisi selesai fase 6 → potongan

| Kriteria                                                                                                            | Potongan                          |
| ------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| Webhook ganda tidak menggandakan pembayaran (tes)                                                                   | 6.0a, 6.0d, 6.1a, 6.1b, 6.2, 6.9  |
| Webhook dengan tanda tangan salah/kedaluwarsa ditolak                                                               | 6.0a, 6.0d, 6.1a, 6.8, 6.9        |
| Nominal webhook ≠ tagihan → pengecualian, bukan lunas                                                               | 6.1b, 6.2, 6.7, 6.9               |
| Rekonsiliasi harian mencocokkan 3 sumber dan melaporkan selisih                                                     | 6.0d, 6.3, 6.7, 6.9               |
| Pencairan piutang dibatasi plafon dan advance rate; pelunasan otomatis saat BPJS bayar menghasilkan jurnal benar    | 6.0b, 6.0d, 6.4, 6.9              |
| Aturan umum (migrasi, seed, tes izin + isolasi, audit, teks Indonesia, lint/typecheck/test hijau, demo tetap hidup) | setiap potongan; diperiksa di 6.9 |

---
