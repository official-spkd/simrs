# Cara sistem bekerja

Halaman ini menjelaskan SIM RS dari sudut pandang sistem: apa yang dibangun, bagaimana bagian-bagiannya saling bicara, dan pengaman apa yang menjaga data pasien. Detail kode ada di [Cara kode bekerja](./02-cara-kerja-kode.md); langkah praktis ada di [Tutorial](./03-tutorial.md).

> Status saat panduan ini ditulis: **fase 0 (fondasi)**. Belum ada fitur bisnis (pendaftaran, rekam medis, kasir). Yang sudah berjalan adalah kerangka yang akan dipakai semua fitur: isolasi tenant, outbox integrasi, API, worker, mock, dan sistem desain.

## Apa yang dibangun

SIM RS adalah **satu platform untuk banyak rumah sakit** (SaaS multi-tenant). Setiap RS adalah satu _tenant_. Rencana produksinya hibrida: server di cloud untuk semua RS, ditambah server _edge_ di tiap RS agar layanan tetap jalan saat internet putus.

Sistem terdiri dari 81 komponen dalam 7 lapisan. Kodenya dipakai di seluruh dokumen, commit, dan tabel.

| Kode | Lapisan                         | Contoh komponen                                                    |
| ---- | ------------------------------- | ------------------------------------------------------------------ |
| P    | Platform inti                   | P01 tenant, P02 login, P03 otorisasi, P04 audit, P05 indeks pasien |
| F    | Front office                    | F01 jadwal dokter, F03 registrasi, F04 antrean, F05 anjungan       |
| K    | Klinis (rekam medis elektronik) | K02 rawat jalan, K03 IGD, K07 CPPT, K09 order + CDS                |
| S    | Penunjang                       | S01 laboratorium, S04 farmasi klinis, S06 kamar operasi            |
| U    | Keuangan                        | U02 charge capture, U03 kasir, U05 klaim BPJS, U07 akuntansi       |
| B    | Back office                     | B01 logistik, B03 SDM, B06 mutu, B09 rekam medis administratif     |
| I    | Integrasi dan kanal             | I01 integration hub, I02 SATUSEHAT, I03 BPJS, I09 dasbor           |

Daftar lengkap: `docs/02-katalog-komponen.md`. Di kode, daftar yang sama tersedia sebagai `COMPONENTS` di `@simrs/shared`.

## Peta besar

```
  Kanal                       Inti                                   Eksternal (lokal: apps/mock)
 ┌───────────────┐       ┌──────────────────────┐                ┌──────────────────────────┐
 │ Web staf      │──────▶│ API (NestJS)         │                │ BPJS VClaim/Antrean      │
 │ Anjungan      │ HTTPS │  · cek tenant        │                │ E-Klaim INA-CBG          │
 │ Display       │       │  · validasi input    │   outbox       │ SATUSEHAT (FHIR R4)      │
 │ App pasien*   │       │  · aturan bisnis     │──────┐         │ Dukcapil, TTE            │
 │ App dokter*   │       └──────────┬───────────┘      │         │ TPDI (tagihan), BTN      │
 └───────────────┘                  │                  ▼         └────────────▲─────────────┘
                          ┌─────────▼─────────┐  ┌───────────┐                │
                          │ PostgreSQL 16     │◀─│ Worker    │── HTTP + retry ┘
                          │ RLS per tenant    │  │ (BullMQ)  │
                          └───────────────────┘  └─────┬─────┘
                          Redis (antrean job) ◀────────┘     MinIO (dokumen)   * fase 9
```

Prinsip yang terlihat di gambar:

1. **Satu API untuk semua kanal.** Web, anjungan, dan aplikasi mobile tidak pernah menyentuh database langsung.
2. **API tidak pernah memanggil sistem luar di tengah transaksi.** Pesan ke BPJS, SATUSEHAT, dan lainnya ditulis ke tabel _outbox_, lalu dikirim worker. Bila BPJS sedang gangguan, pendaftaran pasien tetap berjalan.
3. **Database adalah penjaga terakhir.** Isolasi antar-RS ditegakkan PostgreSQL (Row-Level Security), bukan hanya oleh kode aplikasi.

## Multi-tenant dan isolasi data

Semua RS berbagi satu database. Setiap baris data domain punya kolom `tenant_id`, dan PostgreSQL menyaring baris itu sendiri.

**Bagaimana penyaringannya bekerja**

1. Setiap permintaan API dibungkus satu transaksi database.
2. Di awal transaksi, aplikasi menyetel variabel sesi `app.tenant_id` ke tenant pemilik permintaan.
3. Setiap tabel domain punya kebijakan RLS `tenant_id = app_current_tenant()`.
4. Fungsi `app_current_tenant()` **melempar galat `TENANT_REQUIRED`** bila variabel itu kosong. Lupa menyetel tenant tidak akan diam-diam mengembalikan data kosong atau data RS lain; query langsung gagal dan ketahuan di tes.

**Akibatnya**

- Pengguna RS A tidak bisa membaca atau mengubah baris RS B, meskipun ID-nya ditebak dengan benar.
- Menulis baris atas nama RS lain ditolak database (`WITH CHECK`).
- Role database aplikasi (`simrs_app`) tidak punya hak `BYPASSRLS`. Hanya role migrasi (`simrs_migrator`) yang memiliki tabel, dan role itu tidak dipakai saat aplikasi berjalan.

**Pengecualian yang disengaja dan sempit**

Worker harus memproses outbox milik semua RS. Ia memakai fungsi `app_active_tenant_ids()` yang hanya mengembalikan **daftar ID tenant**, lalu memproses tiap tenant di dalam transaksi bertenant yang tunduk RLS. Alasan dan batasannya ada di ADR-0008.

## Perjalanan satu permintaan

Contoh: staf membuka data tenant aktif (`GET /api/v1/tenancy/current`).

1. **Header keamanan** dipasang di respons (CSP, anti-framing, `no-store` agar data tidak tersimpan di cache).
2. **Request id** dibuat atau diteruskan (`X-Request-Id`). Id ini muncul di log dan di setiap pesan galat, sehingga keluhan pengguna bisa ditelusuri tanpa mencatat data pasien.
3. **Rate limit** memeriksa jumlah permintaan per IP.
4. **Konteks tenant** ditetapkan. Di fase 0 dari header `X-Tenant-Id` (hanya di lingkungan non-produksi). Mulai fase 1 dari token login.
5. **Validasi input** dengan skema zod. Field tak dikenal ditolak.
6. **Aturan bisnis** di _service_, **akses data** di _repository_.
7. **Transaksi bertenant**: PostgreSQL menerapkan RLS.
8. Bila ada galat di titik mana pun, klien menerima format seragam `{ code, message, details, requestId }` dengan `code` yang stabil (mis. `TENANT_REQUIRED`, `RATE_LIMITED`). Pesan internal tidak pernah dikirim ke klien.

## Integrasi lewat outbox

Semua komunikasi keluar (BPJS, SATUSEHAT, E-Klaim, TPDI, BTN, Dukcapil, TTE) memakai pola _transactional outbox_.

```
 transaksi domain (mis. daftar pasien)
   └─ INSERT outbox_messages (status = pending, idempotency_key unik)   ← satu transaksi, commit bersama
 worker, tiap ~2 detik:
   pending ──klaim──▶ processing ──HTTP 2xx──▶ sent
                          │
                          ├─ 5xx / 408 / 425 / 429 / jaringan ──▶ failed ──(jadwal ulang)──▶ processing …
                          │                                        └─ percobaan ke-8 gagal ──▶ dead (DLQ)
                          └─ 4xx lain / operasi belum didukung ──▶ dead (DLQ) langsung
```

| Konsep               | Penjelasan                                                                                                                                                                                         |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Idempotency key      | Setiap pesan membawa kunci unik per tenant + tujuan. Menulis ulang dengan kunci sama tidak membuat pesan kedua, dan sistem tujuan bisa menolak kiriman ganda.                                      |
| Klaim + lease        | Worker mengunci pesan (`FOR UPDATE SKIP LOCKED`) dan memberi _lease_ 60 detik. Bila worker mati di tengah kirim, pesan diambil ulang setelah lease habis. Beberapa worker aman berjalan bersamaan. |
| Backoff eksponensial | Jeda sebelum percobaan ke-n kira-kira 1, 2, 4, 8, 16, 32, 64 detik (dengan jitter acak), maksimum 5 menit.                                                                                         |
| DLQ                  | Status `dead`. Pesan berhenti dicoba dan worker mencatat peringatan (tanpa isi pesan). Integration Hub (fase 7) akan menampilkan dan mengirim ulang pesan ini dengan audit.                        |
| Jejak                | Setiap percobaan dicatat di `delivery_attempts`: kode HTTP, durasi, galat (dipotong).                                                                                                              |

**Webhook masuk** (TPDI, BTN, fase 6) memakai pola kebalikannya: verifikasi tanda tangan HMAC, simpan mentah di `inbound_events` (unik per id event), jawab 2xx secepatnya, lalu proses di worker. Tanda tangan BPJS dan HMAC TPDI sudah tersedia di `@simrs/shared/node` dan sudah diuji.

## Rekam medis dan jejak audit

- **Tidak ada hapus atau timpa untuk data klinis.** Koreksi membuat versi baru dengan alasan (`version`, `supersedes_id`, `correction_reason`). Data yang sudah ditandatangani elektronik hanya bisa ditambah addendum. Aturan ini berlaku mulai fase 3 (ADR-0004).
- **Audit append-only.** Tabel `audit_events` sudah ada. Role aplikasi tidak punya hak `UPDATE`/`DELETE`, dan trigger database menolak perubahan dari siapa pun. Hash berantai dan pencatatan otomatis setiap akses data pasien dibangun di fase 1 (P04).

## Keamanan berlapis

| Lapisan        | Kontrol                                                                                           | Status    |
| -------------- | ------------------------------------------------------------------------------------------------- | --------- |
| Database       | RLS per tenant, galat bila konteks kosong, role tanpa `BYPASSRLS`, audit append-only              | ✅ fase 0 |
| API            | Validasi zod (field tak dikenal ditolak), format galat tanpa detail internal, log tanpa PHI       | ✅ fase 0 |
| API            | Header keamanan (CSP, nosniff, anti-framing, `no-store`, HSTS di produksi), CORS hanya origin web | ✅ fase 0 |
| API            | Rate limit per IP, batas body 1 MB, batas waktu koneksi (anti-slowloris)                          | ✅ fase 0 |
| Konfigurasi    | `APP_ENV` gagal aman: tidak disetel = produksi, fitur pengembangan mati                           | ✅ fase 0 |
| Jaringan lokal | API dan mock hanya mendengar di `127.0.0.1`                                                       | ✅ fase 0 |
| Web            | CSP, anti-framing, area superadmin tertutup di produksi                                           | ✅ fase 0 |
| Integrasi      | Outbox + idempotensi + DLQ; tanda tangan BPJS; HMAC webhook TPDI dengan batas umur 5 menit        | ✅ fase 0 |
| Identitas      | Login, MFA TOTP, sesi pendek, RBAC + ABAC, break-the-glass                                        | ⬜ fase 1 |
| Audit          | Hash berantai, audit setiap baca/ubah data pasien, laporan anomali                                | ⬜ fase 1 |
| Data           | Enkripsi kolom identitas (NIK, no. BPJS) + hash untuk pencarian                                   | ⬜ fase 1 |

Rujukan regulasi: KMK 1596/2024 (51 elemen MRMIK), Permenkes 24/2022, UU 27/2022 tentang PDP. Ringkasannya di `docs/03-regulasi-mrmik.md`; terjemahan ke kontrol teknis di `docs/05-keamanan.md`.

## Lingkungan dan APP_ENV

Variabel `APP_ENV` menentukan fitur pengembangan mana yang hidup. Nilai yang tidak dikenal, kosong, atau tidak disetel dianggap `production`.

| Perilaku                                      | `local` / `staging` | `production` (atau tidak disetel)   |
| --------------------------------------------- | ------------------- | ----------------------------------- |
| Swagger `/docs` di API                        | aktif               | tidak ada (404)                     |
| Endpoint `/api/v1/dev/*`                      | aktif               | tidak terdaftar (404)               |
| Tenant dari header `X-Tenant-Id`              | diizinkan           | ditolak `401` sampai login tersedia |
| Area superadmin web (panduan ini, Fondasi UI) | terbuka tanpa login | tertutup (404)                      |
| HSTS                                          | mati                | aktif                               |

## Mock dan data fiktif

Selama pengembangan, semua sistem luar ditiru oleh `apps/mock` di `http://localhost:4100` (ADR-0006). Mock meniru kontrak aslinya, termasuk tanda tangan BPJS dan enkripsi respons, dan punya panel kendali untuk memicu skenario: lambat, gagal, webhook ganda, tagihan dibayar, kedaluwarsa.

Semua data lokal **fiktif**. NIK uji berawalan `9999`, nama tenant "RS Fiktif …", kode CBG berawalan `SIM-`. Jangan pernah memasukkan data pasien asli ke lingkungan pengembangan.

## Peta fase

| Fase | Isi                                                                                        | Status                                        |
| ---- | ------------------------------------------------------------------------------------------ | --------------------------------------------- |
| 0    | Fondasi repo, infrastruktur, RLS, outbox, mock, sistem desain                              | 🟨 hampir selesai (tes BullMQ menunggu Redis) |
| 1    | Platform inti: tenant, login + MFA, otorisasi, audit, indeks pasien, master data, formulir | ⬜                                            |
| 2    | Front office: jadwal, booking, registrasi + SEP, antrean, anjungan                         | ⬜                                            |
| 3    | Klinis RME: poli, IGD, rawat inap, CPPT, order + CDS, eMAR, resume                         | ⬜                                            |
| 4    | Penunjang: lab + nilai kritis, farmasi, kamar operasi                                      | ⬜                                            |
| 5    | Keuangan: tarif, kasir, klaim, akuntansi                                                   | ⬜                                            |
| 6    | Pembayaran TPDI × BTN dan pembiayaan                                                       | ⬜                                            |
| 7    | Integration hub + SATUSEHAT                                                                | ⬜                                            |
| 8    | Back office                                                                                | ⬜                                            |
| 9    | Dasbor + aplikasi mobile                                                                   | ⬜                                            |
| 10   | Simulasi end-to-end, ketahanan, persiapan pilot                                            | ⬜                                            |

Status terbaru selalu ada di `docs/PROGRESS.md`; kriteria selesai tiap fase di `docs/09-rencana-fase.md`.
