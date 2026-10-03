# CLAUDE.md · SIM RS

Panduan tetap untuk Claude Code di repo ini. Baca seluruhnya di awal setiap sesi.
Bahasa: **jawab dan tulis teks UI dalam Bahasa Indonesia**. Kode, nama variabel, dan pesan commit dalam bahasa Inggris.

## 1. Apa yang dibangun

SIM RS multi-tenant (satu platform untuk banyak RS), deployment hibrida (server edge di RS + cloud).
81 komponen dalam 7 lapisan: P platform, F front office, K klinis RME, S penunjang, U keuangan, B back office, I integrasi dan kanal.
Sumber kebenaran:
- Komponen dan dependensi: `docs/02-katalog-komponen.md`
- Regulasi RME (KMK 1596/2024, 51 EP MRMIK): `docs/03-regulasi-mrmik.md`
- Arsitektur: `docs/01-arsitektur.md` · data: `docs/04-data-model.md` · keamanan: `docs/05-keamanan.md`
- Integrasi: `docs/06-integrasi.md` · pembayaran BTN × TPDI: `docs/07-pembayaran-btn-tpdi.md`
- UI: `docs/08-desain-ui.md` dan mockup di `design/mockups/*.dc.html`
- Urutan kerja: `docs/09-rencana-fase.md` · status: `docs/PROGRESS.md`

Bila dokumen dan permintaan pengguna bertentangan, **tanya dulu**. Bila dokumen tidak mengatur, pilih opsi paling sederhana yang tidak melanggar prinsip di bagian 4, lalu catat sebagai ADR baru di `docs/adr/`.

## 2. Peta repo (target setelah fase 0)

```
apps/
  api/          NestJS: modul per bounded context (src/modules/<konteks>)
  worker/       NestJS standalone + BullMQ: outbox, retry, job terjadwal
  web/          Next.js App Router: staf (/), anjungan (/kiosk), display (/display)
  mock/         Mock integrasi + panel kendali (BPJS, E-Klaim, SATUSEHAT, Dukcapil, TTE, TPDI, BTN)
  mobile/       Expo (mulai fase 9)
packages/
  db/           Prisma schema, migrasi, seed, helper RLS
  shared/       Tipe, skema zod, enum, kode komponen, util tanggal/uang
  ui/           Token desain + komponen React (Klinis Bersih)
  fhir/         Pemetaan domain → FHIR R4 (SATUSEHAT)
  config/       eslint, tsconfig, prettier bersama
infra/          docker, skrip SQL init
docs/           dokumentasi (jangan dihapus; perbarui bila keputusan berubah)
design/         token + mockup acuan (read-only)
```

## 3. Perintah

```bash
pnpm install                 # pasang dependensi
docker compose up -d         # infra lokal
pnpm db:migrate              # prisma migrate dev
pnpm db:seed                 # data fiktif (2 tenant RS, staf, pasien)
pnpm dev                     # api + worker + web + mock (turbo)
pnpm lint && pnpm typecheck  # wajib hijau sebelum commit
pnpm test                    # unit + integrasi (vitest / jest)
pnpm test:e2e                # Playwright (web) — skenario simulasi end-to-end
```
Jangan menjalankan perintah yang menghapus volume Docker atau database tanpa izin eksplisit.

## 4. Prinsip yang tidak boleh dilanggar

1. **Multi-tenant**: setiap tabel domain punya `tenant_id` (uuid, NOT NULL) dan kebijakan RLS. API menyetel `app.tenant_id` per transaksi lewat helper di `packages/db`. Jangan pernah query tanpa konteks tenant; tes isolasi wajib ada untuk setiap modul baru.
2. **Rekam medis immutable**: entri klinis (CPPT, asesmen, diagnosis, order, hasil, resume, consent) tidak di-UPDATE/DELETE. Koreksi = versi baru (`version`, `supersedes_id`, `correction_reason`, `corrected_by`). Data final ber-TTE dikunci; perubahan lewat addendum.
3. **Audit trail append-only**: baca, buat, ubah, cetak, ekspor, dan break-the-glass dicatat di `audit_event` (hash berantai). Gunakan interceptor/decorator `@Audited()`; jangan menulis log audit manual di controller.
4. **Otorisasi berlapis**: RBAC (peran) + ABAC (unit, relasi dengan pasien, hak tulis per formulir). Akses darurat (break-the-glass) wajib alasan, berbatas waktu, dan memicu notifikasi ke petugas privasi.
5. **Integrasi lewat outbox**: transaksi lokal commit dulu, lalu pesan ke BPJS/SATUSEHAT/E-Klaim/TPDI/BTN dikirim worker dengan retry eksponensial, idempotency key, dan DLQ. Jangan memanggil API eksternal di dalam transaksi database.
6. **Webhook masuk**: verifikasi tanda tangan (HMAC), simpan event mentah, dedup dengan idempotency key, proses async. Respons 2xx secepatnya.
7. **Uang**: simpan sebagai `bigint` rupiah (tanpa desimal). Jangan pakai float. Setiap mutasi uang menghasilkan jurnal otomatis berpasangan (debit = kredit).
8. **Dana pasien tidak transit di TPDI**: TPDI hanya orkestrasi tagihan/notifikasi/laporan; dana masuk langsung ke rekening RS di BTN (ADR-0005).
9. **Gerbang keselamatan tidak bisa dilewati diam-diam**: CDS (alergi, interaksi, dosis ginjal), nilai kritis lab, pindai gelang eMAR, surgical safety checklist. Override = alasan wajib + tercatat + dapat ditinjau.
10. **Kode baku**: ICD-10 (WHO) dan ICD-9-CM untuk diagnosis/prosedur, LOINC untuk lab, KFA untuk obat, SNOMED CT bila tersedia. Jangan mengarang kode; bila butuh contoh, ambil dari seed yang sudah ada.
11. **Data lokal fiktif**. Jangan menyalin data pasien nyata. NIK di seed harus jelas fiktif.
12. **Rahasia** hanya di `.env` (tidak di-commit). Kredensial nyata BPJS/SATUSEHAT/TPDI/BTN tidak pernah dipakai di lokal.

## 5. Konvensi kode

- TypeScript `strict`. Tanpa `any` kecuali di batas sistem eksternal (beri komentar alasan).
- Validasi input pakai zod (skema di `packages/shared`, dipakai API dan web). DTO NestJS dibangkitkan dari skema zod.
- Struktur modul API: `controller` (tipis) → `service` (aturan bisnis) → `repository` (Prisma). Event domain lewat `EventEmitter` internal; efek samping ke luar lewat outbox.
- ID: UUID v7. Waktu: `timestamptz` di DB, ISO 8601 di API, tampilan zona `Asia/Jakarta`.
- Penamaan DB: `snake_case`, tabel jamak (`patients`), kolom FK `<entitas>_id`.
- Endpoint REST: `/api/v1/<konteks>/<sumber>`; daftar dengan paginasi kursor; error format `{ code, message, details }` dengan kode stabil (mis. `CDS_BLOCKED`, `TENANT_MISMATCH`).
- Nomor dokumen (RM, SEP lokal, invoice, jurnal) dibangkitkan oleh layanan penomoran per tenant, bukan di kode modul.
- Fitur per RS di balik feature flag tenant (`tenant_modules`).
- Setiap modul menyertakan: migrasi, seed minimal, tes unit service, tes integrasi API (termasuk isolasi tenant dan izin), dan entri di `docs/PROGRESS.md`.

## 6. UI

- Ikuti `docs/08-desain-ui.md` dan token di `packages/ui` (palet teal klinis, IBM Plex Sans/Mono, latar dot halus, radius 10–14).
- Mockup `design/mockups/<Layar>.dc.html` adalah acuan tata letak, isi, dan interaksi. Baca markup + blok `<script type="text/x-dc">` untuk memahami state dan alurnya; implementasikan ulang sebagai komponen React, jangan menyalin runtime mockup.
- Aksesibilitas: elemen interaktif asli (`button`, `a`, `input`), label terlihat, kontras ≥ 4,5:1, target sentuh ≥ 44 px (anjungan ≥ 64 px), status tidak hanya lewat warna.
- Banner pasien (nama, umur, RM, alergi, penjamin) tampil di setiap layar klinis.
- Semua teks UI Bahasa Indonesia; angka rupiah `Rp 1.250.400`; tanggal `Sen, 5 Okt 2026 · 07.10`.

## 7. Cara kerja per fase

1. Baca `docs/PROGRESS.md` dan bagian fase terkait di `docs/09-rencana-fase.md`.
2. Masuk **plan mode** untuk fase/sub-langkah besar; tulis rencana singkat (file yang dibuat, migrasi, tes) dan minta persetujuan.
3. Kerjakan dalam potongan kecil; setelah tiap potongan: `pnpm lint && pnpm typecheck && pnpm test` harus hijau.
4. Commit per potongan dengan Conventional Commits (`feat(mpi): ...`, `fix(billing): ...`), sebutkan kode komponen di badan commit.
5. Perbarui `docs/PROGRESS.md`: centang kriteria yang lolos, catat keputusan, utang teknis, dan langkah berikutnya.
6. Di akhir fase, jalankan checklist "Definisi selesai" fase itu dan laporkan ringkas apa yang lolos/tidak.

## 8. Jangan

- Jangan menambah dependensi besar (ORM lain, state manager, UI kit pihak ketiga) tanpa ADR.
- Jangan menulis SQL mentah yang melewati RLS (`SET ROLE` superuser, `BYPASSRLS`) di kode aplikasi.
- Jangan menghapus atau melemahkan tes yang gagal agar hijau; perbaiki penyebabnya.
- Jangan memanggil layanan eksternal nyata dari lokal; semua lewat `apps/mock`.
- Jangan mengubah `design/` dan `docs/03-regulasi-mrmik.md` kecuali diminta.
