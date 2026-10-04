# Rencana fase 2 · Front office (F01–F08)

Disusun 5 Okt 2026. **Disetujui pemilik produk 5 Okt 2026: semua rekomendasi di §4 diterima.** Nomor ADR: 0024 = PIN masuk cepat (fase 1, 10c-2); fase 2 memakai 0025 = lookup sinkron, 0026 = SSE, 0027 = prinsipal perangkat.

## 1. Ringkasan

Fase 2 membangun backend nyata untuk:

- F01 jadwal dan kuota
- F02 booking
- F03 registrasi rawat jalan, IGD, dan rawat inap
- F04 antrean, display real-time, dan task ID BPJS
- F05 anjungan
- F06 penjaminan, SEP, SPRI, dan rencana kontrol
- F07 rujukan
- F08 gateway informasi publik

Keempat layar presentasi disambungkan ke API (`DATA_SOURCE=api`). Jalur demo tetap hidup untuk presentasi.

Urutan pengerjaan:

1. Kontrak bersama dan skema DB (berurutan).
2. Infrastruktur: konektor BPJS di worker, SSE, prinsipal perangkat, mock lengkap, E2E stack.
3. Modul domain dikerjakan paralel.
4. Registrasi.
5. Anjungan, IGD, dan gateway, ditutup dengan E2E DoD.

**Prasyarat:**

- 10c-2 (PIN) sudah tergabung. Tabel `registered_devices` dipakai ulang untuk anjungan dan TV.
- 10d dan potongan 11 (penutup fase 1) selesai.

**Pemetaan kode:** docs/09 menamai F07 = IGD/ranap + SPRI dan F08 = gateway portal, sedangkan katalog docs/02 memakai F07 = Rujukan dan F08 = Layanan informasi. Usul: ikuti katalog, seperti keputusan kode P sebelumnya.

## 2. Potongan kerja (urut dependensi)

### 0a · Kontrak bersama (`packages/shared`)

- Katalog izin: `schedule` (read, write, sync), `booking` (read, write, cancel), `encounter` (read, write, cancel), `coverage` (read, write), `queue` (read, call, manage), `referral` (read, write), ditambah izin perangkat `kiosk.use` dan `queue.display.read`.
- Matriks bawaan:
  - Pendaftaran: semua izin di atas berlingkup `all`.
  - Dokter, perawat, bidan: `queue.call` (lingkup unit), `schedule.read`, `encounter.read` (lingkup relationship).
  - Kasir, koder, RM: `encounter.read` dan `coverage.read`.
  - Admin: `schedule.write`, `schedule.sync`, `queue.manage`.
- Penomoran harian: `booking_code` (10 digit) dan `queue_ticket` (`<prefix>-<3 digit>` per layanan per hari).
- Pengaturan: `queue.avg_service_minutes`, `booking.max_days_ahead`, `schedule.jkn_share_percent` (80), `kiosk.lookup_rate_per_min`.
- Konstanta operasi outbox BPJS dan nama event domain (`booking.checked_in`, `queue.ticket_called`/`started`/`finished`, `encounter.registered`, `sep.issued`, `encounter.cancelled`).
- Revisi `schemas/front-office.ts`: buang daftar pasien pra-muat dan `vclaimLatencyMs`; ID slot menjadi UUID.
- Kontrak zod `integrations/bpjs/{vclaim,antrean,hfis}.ts`, dipakai mock, worker, dan API.

### 0b · Skema DB + migrasi + seed (`packages/db`), setelah 0a

Aturan untuk semua tabel: `tenant_id` + RLS `FORCE`, FK komposit `(tenant_id, id)`, FK dibungkus `NO FORCE`/`FORCE`, tanpa DELETE.

- **Master:** `practitioners`, `external_ids` (kode poli BPJS, kode dokter HFIS), `payers`, `queue_services`, `queue_displays` (+ `queue_display_services`).
- **F01:**
  - `practitioner_schedules` (templat mingguan).
  - `schedule_sessions` dengan kuota JKN/non-JKN. **CHECK `booked <= quota`**, sehingga kuota dijamin DB.
  - `hfis_schedule_snapshots`.
- **F02:** `appointments` (`booking_code` unik dan tidak bisa diubah; perubahan status diaudit).
- **F04:**
  - `queue_tickets`.
  - `queue_calls`: append-only, dengan `pg_notify` yang hanya membawa tenant + id.
  - `bpjs_queue_tasks`: unik per (booking, task); waktu tidak bisa diubah.
- **F03/F06:**
  - `encounters`.
  - `encounter_status_history` (append-only).
  - `coverages`: terkunci setelah SEP terbit.
  - `referrals`.
  - `seps`: berversi dan beku setelah `issued`.
  - `patient_contacts` (terenkripsi).
  - `privacy_consents`: tambah `encounter_id` dan `evidence_document_id`.
- **Helper:** `reserveQuota`/`releaseQuota` (UPDATE atomik bersyarat) dan `allocateQueueNumber`.
- **Migrasi data izin:** izin baru masuk ke peran RS yang sudah ada.
- **Seed:** poli PD/JT/SR/PR, loket A, farmasi F; dokter fiktif; templat jadwal; payer; display.
- **Tes:** RLS, CHECK kuota, 20 reservasi serentak untuk 1 sisa kuota → tepat 1 berhasil, append-only, beku SEP.

### 0c · Fondasi web hybrid demo/api (paralel dengan 0b)

- ID fixture demo yang memuat nama pasien diganti UUID konstan (±23 berkas).
- `lib/server/data/front-office.ts` dipecah per layar.
- Helper `requireScreen(id)`: mode demo memakai gerbang demo, mode api memakai sesi dan izin asli.
- Halaman: jalur demo dipindah ke `demo-*.tsx`.
- E2E demo tetap hijau.

### 1a · Infrastruktur worker

- Konektor BPJS: header bertanda tangan + dekripsi; pemetaan `metaData.code` ke kode internal; galat bisnis di HTTP 200 dicatat sebagai "ditolak", bukan DLQ.
- Kebijakan retry per operasi. Sekarang 8× ≈ 4–5 menit lalu DLQ, terlalu pendek untuk BPJS.
- Hasil `{ defer }` untuk urutan task ID.
- Hook `onDead` supaya status DLQ terlihat di domain (sekaligus menutup utang TTE).
- P11 minimal: job berkala per tenant.

### 1b · Infrastruktur API

- **ADR-0025 lookup sinkron** di luar transaksi, hanya untuk lookup baca-saja; penulisan tetap lewat outbox.
- **ADR-0026 SSE:** `LISTEN` Postgres, replay `Last-Event-ID`, heartbeat 15 detik.
- **ADR-0027 prinsipal perangkat** (kiosk/display) dengan izin tetap.
- Publisher event domain.
- Kerangka modul `scheduling`, `booking`, `queue`, `registration`, `sep`, `referral`, `kiosk`, `patient-portal-gateway`.
- Tes: SSE tidak bocor antar-tenant, perangkat 403 di endpoint staf, timeout → 503 `BPJS_UNAVAILABLE`.

### 1c · Mock BPJS lengkap

- VClaim: peserta, rujukan, SEP 2.0, rencana kontrol, SPRI, fingerprint, referensi.
- Antrean: add, updatewaktu (validasi urutan), batal, getlisttask, jadwal dokter + HFIS.
- Aturan fiktif: kartu …0000 tidak aktif, rujukan …99 kedaluwarsa.

### 1d · Infrastruktur E2E

- Mock (port 4110) dan worker di Playwright.
- Perangkat uji.
- Helper skenario mock.

### 2 · F01 Jadwal

- API `/api/v1/scheduling`: minggu, kuota hari ini, templat, ubah kuota (409 `QUOTA_BELOW_BOOKED`), cuti/pengganti, alih, kirim/beda HFIS.
- Outbox `bpjs.hfis.update`; job pembangkit sesi 30 hari + tarik HFIS.
- Layar Jadwal ke API.

### 3 · F02 Booking

- API booking: buat (reserveQuota, kode booking, nomor poli, `bpjs.antrean.add`), daftar, by-code, batal (lepas kuota, task 99), jadwal ulang, check-in.
- Job no-show (+ pengingat bila disetujui).
- Tes booking serentak di sisa kuota terakhir.
- **DoD:** kuota.

### 4a · F04 Antrean + mesin task ID

- API antrean: layanan, tiket, panggil-berikutnya, ulang/lewati/mulai/selesai, papan display, SSE.
- Task ID dari event domain, bukan dari tombol:
  - check-in → 1
  - panggilan loket → 2
  - terdaftar → 3
  - poli mulai/selesai → 4/5
  - batal → 99
- Outbox `updatewaktu` dengan `defer` agar urutan terjaga.

### 4b · Web display + kendali antrean

- TV memakai `EventSource` lewat BFF dan sesi perangkat; suara panggilan.
- Halaman staf "Kendali antrean" (bila disetujui).
- **DoD:** display real-time.

### 5a · F03/F06 Registrasi RJ + SEP (API), setelah 3 dan 4a

- Registrasi rawat jalan (Idempotency-Key): encounter, coverage, persetujuan umum, DPJP; SEP `pending`.
- Lookup Dukcapil, eligibilitas, dan rujukan (sinkron).
- SEP: versi, kirim ulang, batal.
- Kontak penanggung jawab.
- Relasi akses DPJP.
- Tes: SEP ganda/timeout tidak menghasilkan dua SEP; mock gagal → registrasi tetap 201, SEP `pending`, lalu `issued`.
- **DoD:** gangguan BPJS.

### 5b · Web Pendaftaran (api)

- Pencarian, pasien baru (MPI + duplikat + Dukcapil), penanggung jawab, kepesertaan, rujukan, kuota.
- Chip status SEP + task 1–3 hidup.
- Persetujuan umum.
- Cetak tiket/SEP (HTML 80 mm).

### 6 · F05 Anjungan

- API kiosk (prinsipal perangkat, rate limit per perangkat): identify (tersamar), check-in, registrasi, tiket, bantuan, cetak.
- Layar anjungan ke API (target ≥ 64 px dipertahankan).
- **DoD:** rantai anjungan.

### 7 · IGD + admisi ranap + SPRI + rencana kontrol + F07 rujukan + ABAC unit

- Registrasi IGD (pasien tanpa identitas boleh), admisi IMP `planned`, surat kontrol, SPRI, rujukan keluar/internal.
- ABAC lingkup unit = encounter aktif di unit penugasan.

### 8 · F08 Gateway informasi publik

- Endpoint publik tanpa PHI: jadwal + sisa kuota, antrean berjalan, status booking (kode + tanggal lahir di body).
- Rate limit.

### 9 · Penutup fase 2

- E2E DoD: anjungan → loket → SEP → PD-0xx di display → task 1–3 `sent`.
- E2E downtime BPJS.
- Review keamanan, ADR, panduan, PROGRESS, QA visual, regresi demo.

## 3. Paralelisasi (maks. 4 agen sekaligus)

- 0a → 0b berurutan.
- **Gelombang A:** 0b ∥ 0c.
- **Gelombang B:** 1a ∥ 1b ∥ 1c ∥ 1d.
- **Gelombang C:** 2 ∥ 3 ∥ 4a, lalu 4b.
- **Gelombang D:** 5a, lalu 5b ∥ 6 ∥ 7 ∥ 8.
- Aturan konflik:
  - Migrasi lanjutan memakai blok cap waktu per potongan.
  - Peta `operations.ts`/`screens.ts` diubah satu baris per potongan.
  - PROGRESS hanya diubah agen penggabung.

## 4. Keputusan (semua rekomendasi bercetak tebal DISETUJUI 5 Okt 2026)

1. **Lookup BPJS/Dukcapil interaktif:** **sinkron dari API di luar transaksi (ADR-0025)**. Ini mengubah keputusan 4 Okt untuk lookup baca-saja. Alternatif: lewat outbox + polling (±2 detik lebih lambat, kredensial hanya di worker).
2. **Autentikasi anjungan/TV:** **perangkat terdaftar per unit dengan izin tetap**, bukan akun staf.
3. **Konfirmasi identitas di anjungan:** **nama tersamar + tanggal lahir tanpa tahun + rate limit** (mockup menampilkan data utuh).
4. **Jalur demo setelah tersambung:** **dipertahankan, dibekukan, dan diuji E2E demo**.
5. **Kendali panggil antrean poli di fase 2 (tanpa mockup):** **halaman kecil "Kendali antrean"**. Alternatif: tunggu layar Poli fase 3.
6. **UI IGD/admisi:** **API + tab sederhana di Pendaftaran**; papan IGD/bed disambungkan di fase 3.
7. **Web service Mobile JKN:** **tunda ke fase 7**.
8. **WhatsApp ke pasien (pengingat H-1, pengalihan cuti):** **ya, minimal, lewat outbox, tanpa isi klinis**.
9. **Masa berlaku persetujuan umum:** **rawat jalan sampai dicabut, rawat inap per admisi**; bukti = centang petugas + scan opsional.
10. **Cetak tiket/SEP:** **HTML 80 mm (cetak/simpan PDF dari browser)**. Alternatif: PDF server (pustaka baru + ADR).
11. **Kredensial BPJS:** **env tunggal (mock) di fase 2**; per RS terenkripsi + rotasi di fase 7.
12. **Yang boleh ubah jadwal/kuota:** **petugas pendaftaran + admin RS**. Alternatif: peran baru "petugas jadwal".
13. **Retry BPJS/SEP:** **dicoba sampai akhir hari layanan, lalu DLQ + tombol kirim ulang**; poli tidak diblokir SEP pending; klaim (fase 5) mewajibkan SEP.
14. (Pemetaan kode) **Ikuti katalog docs/02**: F07 = Rujukan, F08 = Layanan informasi.

## 5. Risiko dan utang yang ditangani

- **ID fixture bernama pasien** → UUID (0c).
- **ABAC unit** → sebagian di 7; tingkat bed di fase 3.
- **SSE:** proxy tanpa buffering, sesi TV berjam-jam, replay, fan-out multi-instans.
- **Outbox BPJS:**
  - DLQ terlalu cepat
  - SEP tidak idempoten di BPJS (cek SEP yang ada sebelum mengirim ulang)
  - urutan task
  - galat bisnis di HTTP 200
  - throughput dispatcher
- **Izin baru ke peran lama:** migrasi data di 0b.
- **Seed belum selaras:** `POLI-DALAM` vs PD/JT/SR/PR; `practitioners` belum ada.
- **P11 dan P12 belum ada:** versi minimal.
- **Enumerasi** (anjungan, endpoint publik): rate limit, tanggal lahir di body, audit perangkat.
- **Batas tanggal WIB** vs DB UTC (ADR-0014).
- **Riwayat kunjungan** wajib membaca `app_patient_group`.
- **Kunci MPI** per RS saat anjungan + loket ramai.
- **State mock** di memori: E2E harus mereset mock.

## 6. Definisi selesai fase 2 → potongan

| Kriteria                                                                                          | Potongan                        |
| ------------------------------------------------------------------------------------------------- | ------------------------------- |
| Check-in anjungan → SEP → antrean poli dengan mock, task 1–3 tercatat                             | 1a, 1c, 1d, 3, 4a, 5a, 5b, 6, 9 |
| Display menerima panggilan real-time                                                              | 1b, 4a, 4b, 9                   |
| Kuota berkurang saat booking dan tidak bisa melebihi batas                                        | 0b, 3, 2                        |
| Gangguan mock BPJS tidak menghentikan pendaftaran                                                 | 1a, 1c, 5a, 5b, 9               |
| Aturan umum (migrasi, seed, tes izin + isolasi, audit, teks Indonesia, lint/typecheck/test hijau) | setiap potongan; diperiksa di 9 |
