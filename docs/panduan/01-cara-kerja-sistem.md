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

Browser tidak pernah memanggil API langsung. Web (Next.js) menjadi perantara: token login disimpan di cookie yang tidak bisa dibaca skrip, web memanggil API atas nama pengguna, dan memperpanjang sesi secara otomatis. Di sisi API, langkahnya:

1. **Header keamanan** dipasang di respons (CSP, anti-framing, `no-store` agar data tidak tersimpan di cache).
2. **Request id** dibuat atau diteruskan (`X-Request-Id`). Id ini muncul di log dan di setiap pesan galat, sehingga keluhan pengguna bisa ditelusuri tanpa mencatat data pasien.
3. **Rate limit** memeriksa jumlah permintaan per IP.
4. **Konteks tenant dan pengguna** ditetapkan dari token login: RS, pengguna, dan peran dari penugasan yang dipilih. Header `X-Tenant-Id` tanpa login hanya ada di mode pengembang lokal.
5. **Izin** diperiksa: peran harus memegang izin untuk aksi itu. Bila tidak, penolakan dicatat di audit lalu klien menerima `403`.
6. **Validasi input** dengan skema zod. Field tak dikenal ditolak.
7. **Aturan bisnis** di _service_, **akses data** di _repository_, semuanya di **satu transaksi bertenant** (PostgreSQL menerapkan RLS) bersama jejak auditnya.
8. Bila ada galat di titik mana pun, klien menerima format seragam `{ code, message, details, requestId }` dengan `code` yang stabil (mis. `TENANT_REQUIRED`, `RATE_LIMITED`). Pesan internal tidak pernah dikirim ke klien.

## Siapa boleh apa

Hak akses berlapis. Setiap lapis harus lolos:

1. **Peran (RBAC).** Setiap staf punya satu atau lebih _penugasan_: peran di unit tertentu dengan masa berlaku. Saat login, staf memakai satu penugasan. Setiap RS punya 16 peran sistem dengan matriks izin bawaan berprinsip hak minimum. Admin SIM RS bisa menyesuaikan matriks itu, dan setiap perubahannya diaudit.
2. **Relasi dengan pasien (ABAC).** Peran klinis (dokter, perawat, dan lainnya) hanya bisa membuka pasien yang sedang dirawatnya: sebagai DPJP, perawat penanggung jawab, rawat bersama, konsultan, atau petugas unit. Peran administratif seperti pendaftaran dan rekam medis berizin ke seluruh pasien.
3. **Akses darurat (break-the-glass).** Bila keadaan klinis mendesak dan relasi belum tercatat, staf boleh membuka pasien dengan menulis alasan klinis. Akses berlaku sementara (bawaan 60 menit), petugas privasi langsung diberi tahu, dan setiap akses darurat wajib ditinjau.

Semua ini dikelola admin RS di layar **Pengguna & akses** (`/sistem/akses`): undang pengguna, atur penugasan, reset sandi/MFA, nonaktifkan akun, dan sesuaikan matriks izin per peran. Setiap perubahan tercatat di jejak audit. Angka di atas layar (akun tanpa MFA, akun dorman, akses darurat yang belum ditinjau) dipakai untuk reviu akses bulanan (MRMIK 2.1c).

Pengaman tambahan: RS tidak bisa kehilangan admin terakhirnya, admin tidak bisa mengubah akses akunnya sendiri lewat menu admin, dan izin kelola pengguna yang didelegasikan tidak bisa dipakai untuk mengambil alih akun admin.

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
- **Audit append-only.** Role aplikasi tidak punya hak `UPDATE`/`DELETE` atas `audit_events`, dan trigger database menolak perubahan dari siapa pun. Setiap entri menyimpan hash entri sebelumnya (hash berantai), jadi baris yang diubah atau dihapus di tengah rantai (mis. oleh admin database yang mematikan trigger) ketahuan saat rantai diperiksa.
- **Layar Audit** (`/sistem/audit`) untuk petugas privasi dan auditor mutu: cari jejak per pasien, pengguna, peran, atau jenis aksi; periksa keutuhan rantai; tinjau **temuan anomali** (gagal masuk atau akses ditolak berulang, akses pasien di luar jam dinas, volume akses tak wajar); tinjau setiap **akses darurat** (alasan wajib, keputusan "akses sah" atau "perlu klarifikasi") dan lihat laporan hariannya; unduh paket bukti akreditasi (CSV). Meninjau, membuka detail, dan mengunduh juga tercatat di audit. Pencatatan otomatis setiap baca data pasien menyusul bersama indeks pasien (P05).

## Data pasien (MPI)

Setiap pasien punya satu **nomor rekam medis** (contoh `00-41-27-88`) yang dibuat sistem dan tidak bisa diubah. NIK, no. peserta BPJS, IHS SATUSEHAT, paspor, alamat, dan no. HP disimpan terenkripsi; layar menampilkan bentuk tersamar (`3174••••••••0012`). Hanya peran tertentu (pendaftaran, rekam medis) yang bisa membuka nilai utuh, dan setiap pembukaan tercatat.

Petugas mencari pasien dengan satu kotak: nomor RM, NIK, no. BPJS, IHS, atau nama (ejaan berbeda tetap ketemu). Sistem menolak pendaftaran baru dengan NIK yang sudah dipakai pasien lain dan menunjukkan nomor RM pemiliknya, sehingga rekam medis ganda tidak bertambah. Setiap pasien yang tampil di hasil pencarian atau dibuka tercatat di jejak audit. Perawat dan dokter hanya melihat pasien yang mereka rawat, kecuali lewat akses darurat.

**Rekam medis ganda.** Saat pendaftaran, sistem membandingkan pasien baru dengan rekam medis lama (NIK, BPJS, tanggal lahir, nama mirip, ibu kandung, no. HP, alamat) dan memasukkan pasangan yang mirip ke antrean **Rekam medis → MPI**. Petugas rekam medis membandingkan atribut berdampingan, memilih nilai yang benar, lalu memutuskan "gabungkan" atau "bukan orang yang sama" dengan alasan wajib. Penggabungan tidak menghapus atau memindah data: rekam medis B hanya diberi tanda "digabung ke A", semua datanya tetap utuh dan ikut terbaca sebagai riwayat A. Keputusan bisa dibatalkan dalam 30 hari, dan setiap langkah tercatat di jejak audit kedua pasien.

**Verifikasi NIK dan persetujuan privasi.** NIK yang dicatat otomatis dicocokkan ke Dukcapil di latar belakang (lewat antrean integrasi, sehingga gangguan Dukcapil tidak menghentikan pendaftaran). Hasilnya (terverifikasi, tidak sesuai, atau tidak ditemukan) tampil bersama NIK, termasuk saat meninjau rekam medis ganda. Persetujuan umum dan persetujuan pembukaan data ke pihak ketiga (mis. asuransi) dicatat atas nama petugas, bisa dicabut dengan alasan, dan riwayatnya tidak pernah dihapus.

## Data rujukan

Kode baku dipakai bersama semua RS: ICD-10 (diagnosis), ICD-9-CM (prosedur), LOINC (pemeriksaan lab), KFA (obat dan alat kesehatan), dan wilayah administratif. Aplikasi hanya membacanya. Operator platform memasukkan dataset resmi lewat perintah impor; berkas yang memuat satu baris salah ditolak seluruhnya agar tidak ada data setengah jadi. Versi baru tidak menghapus kode lama, hanya menonaktifkannya, sehingga diagnosis lama tetap terbaca. Data contoh di lingkungan lokal hanya kode yang sudah dipakai di desain layar, bukan dataset lengkap.

## Formulir klinis

Formulir asesmen (mis. risiko jatuh Morse) adalah **data**, bukan kode: komite rekam medis mengubahnya di **Sistem → Formulir klinis** tanpa menunggu rilis aplikasi. Setiap perubahan dibuat sebagai draf, diajukan ke komite, lalu diterbitkan sebagai versi baru; versi lama diarsipkan, dan isinya tidak bisa diubah lagi. Isian pasien selalu ditampilkan dengan versi formulir saat diisi.

Isian yang sudah disimpan tidak pernah ditimpa. Koreksi membuat versi baru dengan alasan wajib; nilai lama tetap tersimpan. Hanya profesi yang tercantum di formulir (mis. perawat dan bidan untuk Morse) yang boleh mengisi, dan hanya untuk pasien yang mereka rawat. Skor dan kategori risiko dihitung sistem. Di layar Audit, petugas privasi melihat koreksi sebagai "Versi 1 → versi 2": alasan, nilai sebelum dan sesudah, penulis asli, dan pengoreksi.

## Dokumen dan tanda tangan elektronik

Hasil scan, foto, dan dokumen pasien disimpan sebagai berkas dengan nama acak; sistem hanya menerima PDF, PNG, dan JPEG yang dikenali dari isi berkasnya, maksimal 10 MB. Setiap berkas punya sidik digital (SHA-256) yang dicocokkan ulang setiap kali dibuka, jadi berkas yang diubah di penyimpanan tidak pernah diserahkan. Dokumen tidak pernah dihapus atau ditimpa: salah unggah ditandai batal dengan alasan, dan dokumen yang sudah ditandatangani tidak bisa dibatalkan.

Tanda tangan elektronik dimintakan ke penyelenggara TTE lewat antrean integrasi; yang dikirim hanya sidik digital dokumen, bukan isinya. Setiap tanda tangan punya kode QR. Siapa pun yang memindai QR melihat halaman verifikasi: rumah sakit, jenis dokumen, penanda tangan, waktu, dan sidik digital, tanpa judul dokumen atau identitas pasien.

## Notifikasi

Ikon lonceng di kanan atas menunjukkan jumlah notifikasi baru; halaman **Notifikasi** menampilkan daftarnya. Notifikasi tidak pernah memuat data pasien, hanya jenis kejadian dan tautan ke layar yang berizin (mis. "Akses darurat digunakan" untuk petugas privasi). Kejadian penting juga dikirim ke email, dan yang mendesak ke WhatsApp, bila akun punya alamatnya. Admin mengisi no. HP staf di **Pengguna & akses**; nomor disimpan terenkripsi dan tampil tersamar. Di lingkungan lokal email dan WhatsApp tidak benar-benar dikirim: pesannya masuk kotak masuk di panel mock.

## Keamanan berlapis

| Lapisan        | Kontrol                                                                                                       | Status    |
| -------------- | ------------------------------------------------------------------------------------------------------------- | --------- |
| Database       | RLS per tenant, galat bila konteks kosong, role tanpa `BYPASSRLS`, audit append-only                          | ✅ fase 0 |
| API            | Validasi zod (field tak dikenal ditolak), format galat tanpa detail internal, log tanpa PHI                   | ✅ fase 0 |
| API            | Header keamanan (CSP, nosniff, anti-framing, `no-store`, HSTS di produksi), CORS hanya origin web             | ✅ fase 0 |
| API            | Rate limit per IP, batas body 1 MB, batas waktu koneksi (anti-slowloris)                                      | ✅ fase 0 |
| Konfigurasi    | `APP_ENV` gagal aman: tidak disetel = produksi, fitur pengembangan mati                                       | ✅ fase 0 |
| Jaringan lokal | API dan mock hanya mendengar di `127.0.0.1`                                                                   | ✅ fase 0 |
| Web            | CSP, anti-framing; token hanya di cookie httpOnly (BFF); area superadmin khusus operator platform             | ✅ fase 1 |
| Integrasi      | Outbox + idempotensi + DLQ; tanda tangan BPJS; HMAC webhook TPDI dengan batas umur 5 menit                    | ✅ fase 0 |
| Identitas      | Login, MFA TOTP wajib, sesi buram berotasi, RBAC + ABAC, break-the-glass (API)                                | ✅ fase 1 |
| Audit          | Hash berantai, layar Audit (temuan anomali, laporan akses darurat, ekspor) ✅; audit baca pasien menyusul P05 | 🟨 fase 1 |
| Data           | Enkripsi kolom identitas (NIK, no. BPJS, IHS, alamat, no. HP) + hash untuk pencarian; tampil tersamar         | ✅ fase 1 |

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

**Mode presentasi (ADR-0023).** Layar fase 2–10 yang backend-nya belum ada dibangun lebih dulu dengan data dummy fiktif untuk presentasi ke klien dan direksi. Mode ini hanya hidup bila `APP_ENV=local` **dan** `DATA_SOURCE=demo` (jalankan `pnpm dev:demo`); di staging dan produksi layar itu tidak ada (404) dan menunya redup. Selama mode ini aktif, header selalu menampilkan lencana "Mode presentasi · data fiktif". Status tiap layar (`belum`, `demo`, `api`) ada di `apps/web/src/lib/screens.ts`.

## Mock dan data fiktif

Selama pengembangan, semua sistem luar ditiru oleh `apps/mock` di `http://localhost:4100` (ADR-0006). Mock meniru kontrak aslinya, termasuk tanda tangan BPJS dan enkripsi respons, dan punya panel kendali untuk memicu skenario: lambat, gagal, webhook ganda, tagihan dibayar, kedaluwarsa.

Semua data lokal **fiktif**. NIK uji berawalan `9999`, kode CBG berawalan `SIM-`. Tenant RSFA/RSFB bernama "RS Fiktif …"; tenant RSCM memakai nama RS sebenarnya (fokus pengembangan lokal), tetapi kode Kemenkes/BPJS/SATUSEHAT, pasien, dan stafnya fiktif. Jangan pernah memasukkan data pasien asli ke lingkungan pengembangan.

## Peta fase

| Fase | Isi                                                                                        | Status                                        |
| ---- | ------------------------------------------------------------------------------------------ | --------------------------------------------- |
| 0    | Fondasi repo, infrastruktur, RLS, outbox, mock, sistem desain                              | 🟨 hampir selesai (tes BullMQ menunggu Redis) |
| 1    | Platform inti: tenant, login + MFA, otorisasi, audit, indeks pasien, master data, formulir | 🟨 kriteria lolos, sisa PIN + seed staf       |
| 2    | Front office: jadwal, booking, registrasi + SEP, antrean, anjungan                         | ⬜                                            |
| 3    | Klinis RME: poli, IGD, rawat inap, CPPT, order + CDS, eMAR, resume                         | ⬜                                            |
| 4    | Penunjang: lab + nilai kritis, farmasi, kamar operasi                                      | ⬜                                            |
| 5    | Keuangan: tarif, kasir, klaim, akuntansi                                                   | ⬜                                            |
| 6    | Pembayaran TPDI × BTN dan pembiayaan                                                       | ⬜                                            |
| 7    | Integration hub + SATUSEHAT                                                                | ⬜                                            |
| 8    | Back office                                                                                | ⬜                                            |
| 9    | Dasbor + aplikasi mobile                                                                   | ⬜                                            |
| 10   | Simulasi end-to-end, ketahanan, persiapan pilot                                            | ⬜                                            |

Layar fase 2–10 sedang dibangun lebih dulu dalam mode presentasi (data dummy, ADR-0023); fase itu baru selesai setelah tersambung ke backend. Status terbaru selalu ada di `docs/PROGRESS.md`; kriteria selesai tiap fase di `docs/09-rencana-fase.md`.
