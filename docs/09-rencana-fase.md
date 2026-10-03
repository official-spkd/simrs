# 09 · Rencana fase (localhost → siap pilot)

Setiap fase menghasilkan sesuatu yang **bisa dijalankan dan didemokan** di localhost. Jangan mulai fase berikutnya sebelum "Definisi selesai" fase sebelumnya hijau (catat pengecualian di `PROGRESS.md`).
Kode komponen merujuk `02-katalog-komponen.md`. Layar merujuk `08-desain-ui.md`.

Aturan umum semua fase: migrasi + seed fiktif, tes unit service, tes integrasi API (izin + isolasi tenant), audit untuk akses data pasien, teks UI Bahasa Indonesia, `pnpm lint && pnpm typecheck && pnpm test` hijau.

---

## Fase 0 · Fondasi repo dan infrastruktur

**Tujuan**: kerangka monorepo yang hidup end-to-end (web → API → DB → worker → mock) tanpa fitur bisnis.

Isi:
- Monorepo pnpm + Turborepo: `apps/api`, `apps/worker`, `apps/web`, `apps/mock`, `packages/db`, `packages/shared`, `packages/ui`, `packages/fhir`, `packages/config`.
- `packages/db`: Prisma, role `simrs_migrator`/`simrs_app` (skrip `infra/postgres/init.sql`), helper `withTenant(tenantId, fn)` yang menyetel `app.tenant_id`, tabel `tenants`, `outbox_messages`, `inbound_events`, `audit_events` (kerangka), kebijakan RLS contoh + tes isolasi.
- `apps/api`: NestJS, konfigurasi zod-env, pino, `/health`, `/ready`, Swagger `/docs`, filter error standar, interceptor request-id, modul `tenancy` minimal.
- `apps/worker`: BullMQ, prosesor outbox generik (retry eksponensial, DLQ), job contoh.
- `apps/mock`: server mock (Fastify/Nest) di port 4100 dengan kerangka per sistem (bpjs, eklaim, satusehat, dukcapil, tte, tpdi, btn) + panel kendali HTML sederhana + utilitas tanda tangan BPJS (HMAC, enkripsi respons) dan HMAC webhook TPDI.
- `packages/ui`: token dari `design/tokens.*`, Tailwind preset, komponen `AppShell`, `Sidebar`, `Button`, `Field`, `Chip`, `Alert`, `KpiCard`, `Tabs`; halaman `/dev/ui` di web meniru `Fondasi.dc.html`.
- `apps/web`: Next.js, layout dengan sidebar, halaman beranda kosong, klien API bertipe (dari OpenAPI atau zod).
- Kualitas: ESLint, Prettier, Vitest/Jest, Playwright terpasang; skrip root `dev`, `build`, `lint`, `typecheck`, `test`, `test:e2e`, `db:*`; Husky + lint-staged opsional.

**Definisi selesai**
- [ ] `docker compose up -d` + `pnpm dev` menjalankan semua aplikasi tanpa galat
- [ ] `GET /ready` hijau (DB, Redis, MinIO)
- [ ] Tes membuktikan RLS: query tanpa `app.tenant_id` gagal; tenant A tidak melihat baris tenant B
- [ ] Pesan outbox contoh terkirim ke mock; bila mock diset gagal → retry → DLQ
- [ ] `/dev/ui` menampilkan token dan komponen dasar sesuai Fondasi
- [ ] README per aplikasi singkat; `PROGRESS.md` diperbarui

---

## Fase 1 · Platform inti (P01–P13, prioritas P01–P07, P08, P10)

- P01 tenant, faskes, unit, lokasi (ruang/kamar/bed/kelas), modul aktif, pengaturan.
- P02 IAM: registrasi pengguna oleh admin, login, MFA TOTP, refresh token rotasi, PIN cepat per perangkat, kebijakan password, sesi idle; email OTP lewat Mailpit.
- P03 otorisasi RBAC + ABAC (peran, unit, relasi pasien, hak tulis formulir), break-the-glass.
- P04 audit: interceptor `@Audited`, hash berantai, layar Audit (filter, detail, diff versi, anomali).
- P05 MPI: pasien, identifier terenkripsi + hash, pencarian trigram, deteksi duplikat, merge berjejak (layar MPI), verifikasi NIK ke mock Dukcapil.
- P06 master data rujukan (`ref`): ICD-10, ICD-9-CM, LOINC, KFA (subset contoh), wilayah; importer CSV.
- P07 form engine berversi + layar pembuat formulir (contoh Morse, asesmen awal).
- P08 penomoran; P09 dokumen (MinIO); P10 TTE (mock); P11 notifikasi; P12 pengaturan; P13 hanya antarmuka sinkron (implementasi fase 10).
- Seed: 2 tenant RS fiktif, ±30 staf lintas peran, 200 pasien fiktif.
- Layar: Login, Akses, Audit, Formulir, MPI.

**Definisi selesai**
- [ ] Login + MFA berjalan; akun tanpa MFA tidak bisa membuka modul sensitif
- [ ] Matriks izin: tes otomatis untuk ≥ 10 kombinasi peran × aksi × relasi
- [ ] Setiap baca/ubah data pasien menghasilkan `audit_events`; hash berantai terverifikasi oleh tes
- [ ] Break-the-glass mencatat alasan dan muncul di laporan
- [ ] Merge MPI tidak menghapus apa pun dan bisa ditelusuri
- [ ] Koreksi form_response menghasilkan versi baru dengan alasan; diff tampil

---

## Fase 2 · Front office (F01–F08)

- F01 jadwal dokter + kuota JKN/non-JKN + sinkron HFIS (mock).
- F02 booking (aplikasi/anjungan/loket) + kirim antrean ke BPJS (mock).
- F03 registrasi RJ: cari/daftar pasien, penjamin, cek kepesertaan, rujukan, terbitkan SEP (mock VClaim), persetujuan umum.
- F04 antrean + display (SSE) + panggilan; task id 1–7 dikirim otomatis dari event.
- F05 anjungan `/kiosk` (layar sentuh, keypad, cetak tiket ke PDF).
- F06 SEP/rujukan/rencana kontrol; F07 pendaftaran IGD dan rawat inap (SPRI); F08 gateway portal pasien (API untuk fase 9).
- Layar: Registrasi, Jadwal, Anjungan, DisplayAntrean.

**Definisi selesai**
- [ ] Alur check-in anjungan → SEP → antrean poli berjalan dengan mock, task id 1–3 tercatat
- [ ] Display menerima panggilan real-time
- [ ] Kuota berkurang saat booking dan tidak bisa melebihi batas
- [ ] Gangguan mock BPJS tidak menghentikan pendaftaran (SEP antre di outbox, status terlihat)

---

## Fase 3 · Klinis RME (K01–K15)

- K01 worklist per peran; K02 rawat jalan (SOAP, diagnosis ICD-10, prosedur); K03 IGD (papan, triase 1–5 dengan saran sistem + alasan override, timer).
- K04 rawat inap; K05 ADT + papan bed (status siap/terisi/dipesan/kotor), Aplicare (mock).
- K06 asesmen (form engine); K07 CPPT multi-PPA + co-sign residen + serah terima SBAR; K08 problem list.
- K09 CPOE + order set + **CDS** (alergi, interaksi, duplikasi, dosis ginjal) dengan blokir/override beralasan.
- K10 konsultasi/rawat bersama; K11 consent tablet (tanda tangan pasien/saksi + TTE dokter); K12 askep + **eMAR dengan pindai gelang** (simulasi scan) dan alasan terlambat; K13 resume dihimpun otomatis + rekonsiliasi obat + TTE; K14 ringkasan pasien; K15 paket layanan.
- Event domain untuk charge capture dan outbox SATUSEHAT (dikirim di fase 7, dicatat sejak sekarang).
- Layar: Main (poli), IGD, BedManagement, Ranap, CPOE, Consent, Resume.

**Definisi selesai**
- [ ] Entri klinis final tidak bisa diubah; koreksi berversi
- [ ] Resep dengan alergi terdaftar diblokir; override butuh alasan dan tercatat
- [ ] Pemberian obat tidak bisa dicatat sebelum gelang terverifikasi
- [ ] Resume menarik diagnosis, tindakan, hasil, obat tanpa input ulang; terkunci setelah TTE
- [ ] Residen tidak bisa memfinalkan CPPT tanpa co-sign DPJP

---

## Fase 4 · Penunjang (S01–S10)

- S01 lab: worklist, spesimen barcode, input hasil (manual; analyzer HL7 disimulasikan dari mock), validasi teknis → klinis, delta check, QC dasar.
- S09 nilai kritis: alarm, timer 30 menit, pelaporan dengan read-back, metrik kepatuhan.
- S03 radiologi (order, worklist, ekspertise; PACS fase lanjut).
- S04 farmasi klinis: telaah resep 3 aspek, intervensi apoteker ke dokter; S05 dispensing, stok per depo, batch/ED, FEFO, mutasi.
- S06 kamar operasi: jadwal kamar, surgical safety checklist (sign in/time out/sign out terkunci berurutan), hitung kasa, laporan operasi.
- S02, S07, S08, S10: struktur dasar + order/hasil.
- Layar: Lab, Farmasi, OK.

**Definisi selesai**
- [ ] Nilai kritis tidak bisa ditutup tanpa penerima + read-back; durasi lapor terukur
- [ ] Stok berkurang saat dispensing; batch ED terdekat keluar dulu
- [ ] Time out tidak bisa dikonfirmasi sebelum semua item; insisi terkunci sebelum time out

---

## Fase 5 · Keuangan (U01–U10)

- U01 tarif per kelas/penjamin; U02 charge capture dari event (order, eMAR, ADT, OK, lab); U03 billing/kasir (deposit, tagihan, kuitansi, tunai/EDC manual).
- U04 penjamin & piutang: split porsi pasien vs penjamin, selisih naik kelas (aturan dari master, angka simulasi), umur piutang.
- U05 klaim BPJS + E-Klaim (mock grouper), status pending/dispute; U06 workbench koder (kode dari RME, saran, validasi bukti).
- U07 akuntansi: COA, jurnal otomatis per event, buku besar, tutup periode; U08 jasa pelayanan; U09 kas & bank (rekonsiliasi dasar); U10 hutang usaha.
- Layar: Kasir (tanpa kanal TPDI dulu), Klaim, Akuntansi.

**Definisi selesai**
- [ ] Setiap layanan klinis menghasilkan baris tagihan dengan sumbernya; kasir tidak menambah item tanpa alasan
- [ ] Setiap transaksi uang menghasilkan jurnal seimbang (tes properti)
- [ ] Klaim berjalan: koding → grouper (mock) → final → kirim → status
- [ ] Periode tertutup tidak bisa diubah

---

## Fase 6 · Pembayaran TPDI × BTN dan pembiayaan BTN

Ikuti `07-pembayaran-btn-tpdi.md`.
- `payments`: payment intent, kanal VA BTN/QRIS/EDC, webhook TPDI (HMAC, idempotent), kedaluwarsa, refund bertingkat, kirim tagihan ke WA/aplikasi (stub).
- Rekonsiliasi 3 arah: kasir ↔ laporan TPDI ↔ mutasi BTN; layar pengecualian.
- `financing`: cicilan pasien (status mesin + pencairan → lunas) dan pembiayaan piutang BPJS (pool, drawdown, auto-pelunasan saat BPJS bayar, jurnal).
- Layar: PembayaranBTN, PembiayaanBTN, metode baru di Kasir.

**Definisi selesai**
- [ ] Webhook ganda tidak menggandakan pembayaran (tes)
- [ ] Webhook dengan tanda tangan salah/kedaluwarsa ditolak
- [ ] Nominal webhook ≠ tagihan → pengecualian, bukan lunas
- [ ] Rekonsiliasi harian mencocokkan 3 sumber dan melaporkan selisih
- [ ] Pencairan piutang dibatasi plafon dan advance rate; pelunasan otomatis saat BPJS bayar menghasilkan jurnal benar

---

## Fase 7 · Integration hub dan SATUSEHAT (I01–I06, I12)

- I01 hub: daftar konektor, status, volume, latensi, DLQ, kirim ulang (diaudit), rotasi kredensial.
- I02 SATUSEHAT: token, registrasi Organization/Location, lookup IHS, pengiriman resource dari outbox (Encounter → anak), pemetaan di `packages/fhir` dengan tes snapshot.
- I03 BPJS lengkap (VClaim, Antrean, Aplicare, HFIS); I04 Kemenkes lain (struktur: SIRS online/RL); I05 Dukcapil/TTE/WA/bank; I06 device gateway (antarmuka, simulasi HL7 dari mock).
- I12 FHIR server internal (opsional, baca saja).
- Layar: Integrasi.

**Definisi selesai**
- [ ] Satu kunjungan RJ lengkap terkirim ke mock SATUSEHAT dengan urutan benar
- [ ] Galat 422 masuk DLQ dengan payload yang bisa ditelusuri; kirim ulang berhasil setelah perbaikan data
- [ ] Mode downtime mock (semua eksternal mati) tidak menghentikan layanan klinis

---

## Fase 8 · Back office dan tata kelola (B01–B13, prioritas B01, B03, B06, B09)

- B01 logistik (gudang, PO, penerimaan, ROP, ABC-VEN, kedaluwarsa); B02 aset; B03 SDM inti; B04 kredensial/kewenangan klinis; B05 penggajian (struktur).
- B06 mutu: indikator nasional mutu dari data operasional, insiden keselamatan; B07 PPI; B08 PPRA (dapat dimatikan).
- B09 rekam medis administratif: peminjaman, retensi, pemusnahan berjejak, permintaan salinan (UU PDP).
- B10–B13 struktur dasar, dapat dimatikan per tenant.
- Layar: Logistik (+ layar baru sederhana untuk mutu dan RM administratif mengikuti gaya yang sama).

**Definisi selesai**
- [ ] ROP menghasilkan usulan PO; penerimaan barang menambah stok dan hutang
- [ ] Minimal 5 indikator mutu dihitung otomatis dari data transaksi

---

## Fase 9 · Kanal: dasbor, aplikasi pasien, aplikasi dokter (I07–I09)

- I09 dasbor direksi (BOR, ALOS, kunjungan, waktu tunggu, klaim, bauran penjamin, mutu, kapasitas, alert keputusan).
- `apps/mobile` (Expo) dengan dua mode: pasien (booking, antrean real-time, hasil, resume, tagihan + bayar via TPDI, cicilan, gula darah mandiri) dan klinisi (pasien saya, nilai kritis, co-sign TTE, order cepat).
- Autentikasi pasien terpisah dari staf; data minimal; persetujuan akses keluarga.
- Layar: Dasbor, AppPasien, AppDokter.

**Definisi selesai**
- [ ] Pasien melihat posisi antrean berubah real-time dan dapat membayar tagihan lewat mock TPDI
- [ ] Dokter menerima nilai kritis dan melakukan read-back dari aplikasi

---

## Fase 10 · Simulasi end-to-end, ketahanan, dan persiapan pilot

- Halaman `/simulasi` (non-produksi) dan tes Playwright untuk 3 skenario `Simulasi.dc.html`: rawat jalan BPJS, IGD → rawat inap, elektif TPDI × BTN.
- Seed skenario demo; generator beban sederhana (k6 opsional).
- P13 server edge: desain + prototipe sinkron dua arah untuk satu modul (registrasi) + mode downtime + cetak darurat.
- Backup/restore terjadwal (pg_dump terenkripsi lokal ke MinIO) + uji restore.
- Hardening: rate limit, CSP, header keamanan, `pnpm audit`, review `05-keamanan.md` checklist untuk semua modul.
- Dokumen go-live: runbook, matriks kepatuhan 51 EP MRMIK (bukti per EP), daftar konektor yang perlu sandbox resmi.

**Definisi selesai**
- [ ] Ketiga skenario E2E hijau dari kedatangan sampai klaim/pembiayaan
- [ ] Restore dari backup berhasil di mesin bersih
- [ ] Matriks 51 EP terisi bukti (layar, tes, atau prosedur)
