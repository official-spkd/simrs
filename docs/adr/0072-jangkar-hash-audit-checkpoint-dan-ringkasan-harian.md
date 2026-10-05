# ADR-0072 · Jangkar hash audit ke bucket WORM, verifikasi dari titik periksa, dan ringkasan harian temuan anomali

Status: diterima · 5 Okt 2026 · Komponen: P04 (+ P11 job berkala) · Fase 10 potongan 10.8 · Melengkapi ADR-0004,
ADR-0008

## Konteks

Rantai hash `audit_events` (fase 1) dihitung trigger database dengan SHA-256 tanpa kunci. Tiga kelemahan tercatat
di utang teknis P04:

1. **Pemotongan ekor tidak terdeteksi.** Admin database yang mematikan trigger bisa menghapus baris TERAKHIR; sisa
   rantai tetap bersambung dan `app_verify_audit_chain()` melaporkan utuh. Lebih jauh, karena hash tidak berkunci,
   penyerang yang tahu algoritmanya bisa menulis ulang seluruh rantai sejak baris mana pun dengan hash yang dihitung
   ulang, dan rantai tetap "utuh".
2. **`/audit/verify` memindai seluruh jejak tenant** setiap kali; dengan jutaan baris ini mahal.
3. **Temuan anomali diagregasi dari `audit_events` setiap layar dibuka** (≤ 90 hari).

Keputusan rencana fase 10 §4 #8: jangkar tiap jam ke bucket WORM + HMAC kunci terpisah; verifikasi berbasis
checkpoint.

## Keputusan

### 1. Jangkar (anchor)

- **Isi:** kepala rantai per tenant `{tenant, seq, hash, waktu}`. `waktu` dari jam database
  (`clock_timestamp()`), sama dengan sumber waktu audit.
- **Tanda tangan:** HMAC-SHA256 atas pesan kanonik `simrs/audit-anchor/v1\n<tenant>\n<seq>\n<hash>\n<waktu ISO>`.
  - Kunci `AUDIT_ANCHOR_KEY` (32 byte base64) terpisah dari `FIELD_ENCRYPTION_KEY`/`FIELD_HASH_KEY`; env menolak
    kunci yang sama.
  - Kunci diturunkan per tenant dengan HKDF (seperti kunci kolom), sehingga server edge P13 cukup memegang kunci
    turunan tenantnya.
  - `key_id` = 16 hex pertama SHA-256 kunci induk, disimpan bersama jangkar agar "kunci lain" bisa dibedakan dari
    "isi dirusak".
- **Dua salinan:**
  - tabel `audit_anchors`: append-only (trigger `app_reject_mutation`, `simrs_app` hanya `SELECT, INSERT`), RLS
    FORCE per tenant. `recorded_at` diisi trigger; jangkar bertanggal masa depan ditolak. CHECK mengikat
    `object_key` ke seq-nya;
  - bucket S3/MinIO ber-Object Lock (`AUDIT_ANCHOR_BUCKET`): satu objek per (tenant, seq), kunci
    `audit-anchors/<tenant>/<seq 20 digit>.json`, ditulis dengan `If-None-Match: *`, mode **COMPLIANCE** dan
    `retain-until` = sekarang + `AUDIT_ANCHOR_RETENTION_DAYS` (bawaan 3.650 hari). Versi objek tidak bisa dihapus
    atau ditimpa siapa pun, termasuk root, sampai masa kunci habis.
- **Job `audit.anchor`** (registri P11, tiap jam, per tenant aktif lewat RLS, ADR-0008):
  1. **Rekonsiliasi:** objek di bucket sesudah jangkar sah terakhir di database dicatat ulang (`source = worm`).
     Menghapus baris jangkar di database tidak menyembunyikan pemotongan rantai.
  2. **Periksa** rantai sejak titik periksa terakhir, lalu tanda tangani kepala yang BARU SAJA diperiksa. Fungsi
     `app_verify_audit_chain_from` mengembalikan baris terakhir yang lolos, dari snapshot yang sama.
  3. **Tulis objek WORM** di LUAR transaksi database (prinsip CLAUDE.md §4.5).
  4. **Catat** di `audit_anchors`, idempoten per (tenant, seq). Bila objek sudah ada dari run yang gagal di tengah,
     isi yang sudah terkunci yang dipakai.
- **Aturan job:**
  - Segmen rantai yang rusak (`CHAIN_BROKEN`) tidak pernah dijangkar; titik periksa tidak boleh melompati baris rusak.
  - Job hanya maju melewati jangkar **bertanda tangan sah** terbesar, jadi jangkar palsu bernomor besar tidak bisa
    menghentikan penjangkaran.
  - Temuan lain (pemotongan, jangkar dirusak) tidak menghentikan penjangkaran entri baru. Temuan itu permanen di
    jangkar lama dan dicatat sebagai galat log tiap jam.
- **Membaca bucket:** isi jangkar = **versi pertama** objek; daftar memakai *ListObjectVersions*. Pemegang
  kredensial bucket hanya bisa menambah versi baru (isi palsu, ketahuan dari HMAC) atau penanda hapus, dan keduanya
  tidak mengubah apa yang dibaca job.

### 2. Verifikasi dari titik periksa (`GET /audit/verify`)

- **Langkah 1 · semua jangkar, O(jumlah jangkar).** Setiap jangkar diperiksa tanda tangannya lalu dicocokkan dengan
  entri audit di seq-nya:

  | Kode                  | Arti                                                                              |
  | --------------------- | --------------------------------------------------------------------------------- |
  | `TRUNCATION_DETECTED` | Entri yang dijangkar tidak ada dan kepala rantai di bawah seq jangkar: ekor dipotong |
  | `ANCHOR_MISMATCH`     | Entri di seq itu ada tetapi hash-nya lain: dipotong lalu ditambah, atau ditulis ulang |
  | `ANCHOR_TAMPERED`     | HMAC jangkar tidak sah                                                            |
  | `ANCHOR_KEY_UNKNOWN`  | Jangkar ditandatangani kunci lain                                                 |
  | `CHAIN_BROKEN`        | Hash/urutan entri tidak cocok saat dihitung ulang                                 |

- **Langkah 2 · hitung ulang hash.**
  - `?mode=checkpoint` (bawaan): mulai dari jangkar sah terakhir yang cocok dengan rantai. Baris titik periksa ikut
    dihitung ulang.
  - `?mode=full`: seluruh rantai.
  - Tanpa kunci (hanya di luar produksi): selalu penuh, jangkar tidak dinilai.
- **Respons** tetap memuat `intact`, `checked`, `firstBrokenSeq`, `verifiedAt`, ditambah `mode`, `headSeq`,
  `checkpoint`, `anchors`, `issues` (maks. 20, urut seq), dan `issueCount`. Entri audit `verify` mencatat mode,
  hasil, dan kode temuan.
- **Trade-off yang disengaja:** perubahan mentah (tanpa hitung ulang hash) pada baris SEBELUM titik periksa hanya
  tertangkap mode penuh. Setiap baris sudah diperiksa sekali oleh job sebelum dijangkar. Penulisan ulang yang
  menghitung ulang hash selalu tertangkap kedua mode, lewat jangkar. Mode penuh tersedia di layar
  ("Periksa penuh") dan dipakai uji restore (10.7).

### 3. Ringkasan harian temuan anomali

- **Tabel:**
  - `audit_daily_summaries`: satu baris per tenant × tanggal WIB × kunci parameter;
  - `audit_daily_summary_items`: hitungan per pengguna × jenis (`login_failed`, `access_denied`, `night`, `volume`)
    dengan `n`, `last_at`, dan `actor_role`.
  - Keduanya append-only, RLS, **tanpa PHI** (tanpa id pasien).
- **Kunci parameter:** SHA-256 dari jam malam RS, peran jaga, daftar aksi, ambang minimum, dan versi logika.
  - Bila RS mengubah jam malam, ringkasan lama tidak dipakai (kembali ke agregasi langsung) sampai job menghitung
    ulang. Ringkasan lama tetap ada.
  - Ambang (`audit.burst_threshold`, `audit.volume_threshold`) diterapkan saat membaca. Hitungan di bawah batas
    minimum pengaturan (`AUDIT_*_THRESHOLD_MIN` = 2) dibuang karena tidak pernah bisa menjadi temuan.
- **Job `audit.daily-summary`** (registri P11, pukul 00.20 WIB): tanggal yang sudah final (berakhir ≥ 10 menit) dalam
  90 hari terakhir dan belum diringkas dengan parameter sekarang, terbaru dulu. Idempoten.
- **Pembacaan:**
  - Satu implementasi SQL (`packages/db/src/audit-anomaly.ts`) dipakai agregasi langsung dan job.
  - Layar/API membaca hari lampau dari ringkasan, lalu menghitung langsung hari ini dan rentang tanggal tanpa
    ringkasan.
  - Hasil per jenis digabung, diurutkan terbaru dulu, dan dipotong 50. Hasilnya sama dengan satu agregasi langsung,
    karena setiap kelompok berada di satu tanggal (dibuktikan tes db dan API).
  - Respons `/audit/anomalies` menambah `summarizedDays`.

## Konsekuensi

\+ Pemotongan ekor dan penulisan ulang rantai ketahuan, walau penyerang menguasai database penuh (superuser), selama
kunci jangkar dan bucket WORM di luar jangkauannya. Diuji dengan superuser Postgres sungguhan di DB uji.
\+ `/audit/verify` bawaan O(jangkar + entri sejak jam terakhir); layar temuan membaca ≤ 50 baris ringkasan per jenis.
− **Jendela tanpa perlindungan ≤ 1 jam:** entri sesudah jangkar terakhir bisa dihapus tanpa jejak. Bisa diperpendek
dengan menaikkan frekuensi job.
− API memegang kunci HMAC untuk memeriksa, jadi API yang dibobol bisa memalsukan jangkar di database. Tetapi API
tidak bisa menulis versi pertama objek WORM untuk seq lampau. Alternatif Ed25519 (worker menandatangani, API hanya
kunci publik) dicatat sebagai perbaikan lanjutan.
− `simrs_app` dipakai API dan worker sekaligus, jadi "hanya worker yang menulis jangkar" belum ditegakkan per peran DB.
Jangkar yang ditulis pihak lain tetap harus lolos HMAC. Peran DB khusus worker = utang.
− **Rotasi kunci** belum didukung: jangkar berkunci lama menjadi `ANCHOR_KEY_UNKNOWN`. Perlu daftar kunci lama
sebelum rotasi pertama.
− **Pemulihan dari backup (10.7)** benar memicu `TRUNCATION_DETECTED`/`ANCHOR_MISMATCH` (data sejak backup memang
hilang). Prosedur "pengakuan insiden" (epoch jangkar) menyusul bersama runbook. Sampai saat itu, temuan itu bukti
RPO, bukan kesalahan.
− Bucket COMPLIANCE tidak bisa dibersihkan sebelum masa kunci habis. Lokal memakai `AUDIT_ANCHOR_RETENTION_DAYS=1`;
nilai produksi mengikuti kebijakan retensi RS (MRMIK 11a) dan diputuskan PO.

## Alternatif yang ditolak

- **Hash berkunci di trigger:** kunci harus ada di database, jadi superuser tetap bisa menulis ulang.
- **Tabel jangkar saja tanpa WORM:** superuser bisa menghapus jangkar bersama ekor rantai.
- **Ringkasan berisi temuan yang sudah diberi ambang:** ambang berubah = ringkasan salah. Hitungan mentah per
  kelompok tetap kecil setelah membuang yang di bawah minimum.
- **Penjadwal sendiri:** awalnya dibuat, lalu dipindah ke registri job berkala P11 dari master. Satu antrean, prefiks
  BullMQ per deployment.
