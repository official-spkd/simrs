# Backup dan restore

Runbook backup terenkripsi tiga lokasi dan uji restore (MRMIK 5, keputusan di ADR-0071 `docs/adr/0071-backup-terenkripsi-tiga-lokasi-dan-uji-restore.md`).
Perintah dijalankan di **host ops** (server edge atau mesin operator), bukan oleh aplikasi. Butuh Node 24 dan Docker
(untuk `pg_dump`/`mc`/kontainer uji bila biner lokal tidak ada). Persiapan mesin: [Tutorial](./03-tutorial.md).

## 1. Gambaran

| Lokasi      | Tempat                                                    | Isi                                                     |
| ----------- | --------------------------------------------------------- | ------------------------------------------------------- |
| 1 · edge    | `BACKUP_LOCAL_DIR` (bawaan `.local/backup/<kunci>`)      | `db.dump.enc`, `documents.tar.enc`, `manifest.json`     |
| 2 · cloud   | bucket `S3_BUCKET_BACKUPS` (`simrs-backups/<awalan><kunci>`) | sama, diunggah dari lokasi 1 (manifest paling akhir)   |
| 3 · offsite | bucket `BACKUP_OFFSITE_BUCKET` (produksi: penyedia/region lain) | `mc mirror` seluruh awalan dari lokasi 2, tanpa hapus |

- **Kunci backup** = waktu mulai UTC + jenis, mis. `20261005T000846Z-daily`. Folder yang punya `manifest.json`
  dianggap lengkap.
- **Enkripsi**: kunci publik X25519 + AES-256-GCM. Host backup hanya memegang kunci **publik**. Kunci privat
  disimpan offline dan hanya dipakai saat restore.
- **Manifest** (polos, tanpa data pasien) memuat:
  - SHA-256 setiap berkas sebelum/sesudah enkripsi;
  - jumlah baris per tabel;
  - migrasi yang sudah diterapkan;
  - kepala rantai audit per tenant beserta hasil verifikasinya.
  Semua diambil dari snapshot yang sama dengan dump. Ada pula `digest` atas seluruh isi manifest.
- **Dokumen** mengikuti driver API (`STORAGE_DRIVER`, ADR-0020):
  - `disk`: semua berkas berkunci penyimpanan di `STORAGE_DISK_ROOT`;
  - `s3`: objek bucket `S3_BUCKET_DOCUMENTS` untuk setiap baris `documents` di snapshot dump. Objek di-stream langsung
    dari bucket ke arsip terenkripsi (plaintext tidak menyentuh disk host backup) dan dicocokkan dengan sha256 +
    ukuran barisnya. Objek yang hilang/berbeda dicatat di manifest (`integrityErrors`) dan log `PERINGATAN`; backup
    tetap berjalan dan menyalin apa adanya.
- **Peran DB `simrs_backup`**: baca semua data + BYPASSRLS, tanpa hak tulis, transaksi baca-saja bawaan. Peran ini
  hanya untuk skrip ini, tidak pernah untuk aplikasi.
- Hasil setiap run tercatat di `backup_runs`, dan hasil setiap uji di `restore_tests` (tenant PLATFORM). RS melihat
  ringkasannya di layar Integrasi lewat `app_backup_status()`.

## 2. Persiapan sekali

1. **Peran DB.** Volume Postgres baru otomatis punya peran ini dari `infra/postgres/init.sql`. Untuk cluster yang
   sudah ada, jalankan sebagai superuser, sekali per database:

   ```bash
   docker compose exec -T postgres psql -U postgres -d simrs -v backup_password=backup_local \
     -f - < infra/backup/sql/simrs-backup-role.sql
   ```

   Di produksi, jangan pakai `-v backup_password`. Setel sandi dengan `\password simrs_backup` atau pakai sertifikat.

2. **Pasangan kunci**, dibuat di media offline, bukan di repo dan bukan di host backup:

   ```bash
   pnpm backup:kunci-baru --keluar /media/usb-kunci
   # opsional dua orang: kunci privat dienkripsi frasa sandi dari variabel lingkungan
   FRASA=… pnpm backup:kunci-baru --keluar /media/usb-kunci --frasa-sandi-env FRASA
   ```

   Hasilnya `simrs-backup.pub` (dipasang di host backup) dan `simrs-backup.key` (0600). Simpan **dua salinan** kunci
   privat di dua tempat terpisah, dipegang dua orang: misalnya kepala IT memegang berkas, kepala rekam medis memegang
   frasa sandi. Catat id kunci (16 karakter hex) di berita acara.

3. **`.env` host backup** (contoh lengkap di `.env.example`, blok "Backup"):

   | Variabel                                                             | Isi                                                                                             |
   | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
   | `BACKUP_DATABASE_URL`                                                | `postgresql://simrs_backup:…@host:port/simrs`. Port mengikuti `POSTGRES_PORT`, sama dengan URL database lain |
   | `BACKUP_PUBLIC_KEY` / `BACKUP_PUBLIC_KEY_FILE`                       | `simrsbk1:…`                                                                                    |
   | `BACKUP_PREFIX`                                                      | awalan objek per sumber, mis. `edge-rscm/`                                                      |
   | `BACKUP_OFFSITE_BUCKET`, `BACKUP_OFFSITE_S3_ENDPOINT/_ACCESS_KEY/_SECRET_KEY` | lokasi 3. Bawaannya endpoint lokasi 2 (hanya pantas di lokal)                          |
   | `BACKUP_ENSURE_BUCKETS`                                              | `true` hanya di lokal. Kredensial produksi tidak boleh punya hak membuat bucket                  |
   | `BACKUP_KEEP_*`                                                      | retensi (§5)                                                                                    |
   | `STORAGE_DRIVER`, `S3_BUCKET_DOCUMENTS`                              | sama dengan API; driver `s3` membaca bucket dokumen lewat `S3_ENDPOINT`/`S3_ACCESS_KEY` (cukup hak baca) |
   | `AUDIT_ANCHOR_BUCKET`, `AUDIT_ANCHOR_KEY`                            | hanya di mesin uji restore: bucket WORM jangkar audit dan kunci HMAC-nya (ADR-0072), lihat §6     |
   | `BACKUP_TOOLS`                                                       | `auto` (bawaan): `pg_dump`/`mc` lokal bila versinya cocok, selain itu Docker                     |

   Kunci privat **tidak** dipasang di host backup. `BACKUP_PRIVATE_KEY_FILE` hanya diisi di mesin uji restore.

## 3. Menjalankan backup

```bash
pnpm backup:jalankan --jenis per-jam     # atau harian | manual (bawaan manual)
pnpm backup:jalankan --jenis manual --tanpa-retensi
```

Kode keluar:

| Kode | Arti                                                                                       |
| ---- | ------------------------------------------------------------------------------------------ |
| `0`  | Ketiga lokasi berhasil dan tercatat                                                        |
| `2`  | Sebagian: backup ada di disk lokal, tetapi lokasi jauh gagal atau pencatatan gagal (lihat log) |
| `1`  | Gagal                                                                                      |

Dua backup tidak pernah berjalan bersamaan: kunci advisory di database membuat run kedua langsung gagal dengan
`BACKUP_RUNNING`, dan kegagalan itu ikut tercatat. Log `PERINGATAN: rantai audit rusak di sumber` berarti rantai audit
tenant itu sudah rusak **sebelum** backup. Backup tetap dibuat apa adanya. Laporkan ke petugas audit/privasi.

## 4. Jadwal (host ops)

Contoh crontab (zona Asia/Jakarta, user ops, di root repo):

```cron
5 * * * *   cd /opt/simrs && pnpm backup:jalankan --jenis per-jam  >> /var/log/simrs-backup.log 2>&1
30 1 * * *  cd /opt/simrs && pnpm backup:jalankan --jenis harian   >> /var/log/simrs-backup.log 2>&1
0 3 * * 0   cd /opt/simrs-uji && pnpm backup:uji-restore --sumber cloud   >> /var/log/simrs-uji-restore.log 2>&1
0 4 1 * *   cd /opt/simrs-uji && pnpm backup:uji-restore --sumber offsite --dokumen-ketat >> /var/log/simrs-uji-restore.log 2>&1
```

Uji restore berjalan di **mesin uji terpisah** yang memegang kunci privat. Kode keluar ≠ 0 dari cron harus memicu
alarm (email/WhatsApp operator). RPO dengan backup per jam ≤ 1 jam. Sasaran RPO 15 menit di produksi dicapai dengan
pgBackRest (arsip WAL + PITR), yang dipasang bersama infrastruktur produksi (ADR-0071 butir 13).

## 5. Retensi

Retensi dijalankan otomatis di akhir setiap backup dan dihitung terpisah per lokasi:

- **48** per jam, **35** harian, **12** bulanan (harian terbaru tiap bulan), **10** manual;
- backup lengkap terbaru selalu disimpan;
- folder tanpa manifest dihapus setelah 24 jam;
- nama folder lain tidak disentuh.

Di bucket offsite produksi yang memakai object lock, retensi WORM penyedia yang berlaku. Penghapusan yang ditolak
muncul sebagai `retensi offsite gagal`, tetapi backup tetap dianggap berhasil.

## 6. Uji restore

```bash
pnpm build                                # API hasil build dipakai untuk /ready
pnpm backup:uji-restore --sumber offsite  # lokal | cloud (bawaan) | offsite
pnpm backup:uji-restore --backup 20261005T000846Z-daily --kunci-privat /media/usb-kunci/simrs-backup.key
```

Langkah, berhenti di galat pertama:

| Langkah        | Isi                                                                                        | Gagal bila                                            |
| -------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| `select`       | backup lengkap terbaru (atau `--backup`) di lokasi sumber                                  | tidak ada backup lengkap                              |
| `fetch`        | unduh ke folder kerja baru 0700 (lokal: dibaca di tempat)                                  | unduhan gagal                                         |
| `manifest`     | skema + digest + kunci backup                                                              | **manifest rusak/diubah: gagal keras**                |
| `checksum`     | SHA-256 berkas terenkripsi = manifest                                                      | berkas rusak/terpotong                                |
| `key`          | id kunci privat = manifest = header berkas                                                 | **kunci salah: berhenti sebelum ada plaintext/kontainer** |
| `decrypt`      | dump didekripsi, hash plaintext = manifest                                                 | autentikasi potongan gagal                            |
| `documents`    | arsip dokumen didekripsi + diekstrak, jumlah/ukuran = manifest                             | selisih                                               |
| `container`    | `postgres:16-alpine` bersih + `init.sql` dan Redis (+ MinIO `pgsty/minio` bila dokumen `s3`), port acak di 127.0.0.1 | Docker tidak ada                 |
| `documents_bucket` | (s3) objek hasil ekstrak diunggah ke bucket BARU `simrs-documents` di MinIO sementara; server memverifikasi SHA-256 | unggahan/checksum ditolak |
| `restore`      | `pg_restore --single-transaction --exit-on-error`                                          | galat restore apa pun                                 |
| `migrations`   | `prisma migrate status` (kode saat ini) + daftar migrasi = manifest                        | ada yang tertunda/beda                                |
| `row_counts`   | jumlah baris setiap tabel = manifest                                                       | selisih satu baris pun                                |
| `documents_db` | setiap baris `documents`: berkas hasil ekstrak dengan ukuran + SHA-256 sama, dan (s3) objek di bucket sementara membawa checksum yang sama | s3: selisih apa pun di luar temuan sumber manifest; disk: hanya dengan `--dokumen-ketat` |
| `api_ready`    | API menyala di atas DB hasil restore (mode uji, loopback): `/ready` = DB, Redis, penyimpanan ok (folder hasil ekstrak, atau bucket MinIO sementara untuk s3) | `/ready` tidak 200 |
| `audit_verify` | `/audit/verify` per tenant aktif + `app_verify_audit_chain()` semua tenant = hasil di sumber, kepala rantai = manifest | rantai berbeda dari sumber (terpotong/diubah) |
| `audit_anchors` | jangkar audit sah **terbaru dengan waktu ≤ waktu backup** per tenant (bucket WORM `AUDIT_ANCHOR_BUCKET`; tanpa bucket: tabel `audit_anchors` hasil restore) cocok dengan rantai hasil restore: baris di seq jangkar ada dengan hash sama, kepala tidak di bawahnya, rantai bersambung dari jangkar (`app_verify_audit_chain_from`). Dengan `AUDIT_ANCHOR_KEY`, jangkar palsu/kunci lain dilewati dan dihitung | `ANCHOR_MISMATCH`, `TRUNCATION_DETECTED`, `CHAIN_BROKEN` |

**RTO terukur** dihitung dari mulai sampai `audit_anchors` lolos. Hasil per langkah dicatat ke `restore_tests`
(database sumber, lewat `BACKUP_DATABASE_URL`; `--tanpa-catat` untuk melewati). Laporan JSON disimpan di
`.local/backup-restore/laporan/<id>.json`. Kontainer, proses API, dan semua plaintext dihapus di akhir, berhasil atau
gagal. `--simpan-kontainer` membiarkan kontainer untuk diperiksa; hapus sendiri dengan `docker rm -f`.

Tes otomatis yang sama: `pnpm --filter @simrs/backup test:pemulihan`. Isinya:
- driver disk + jangkar tabel: backup → tiga lokasi → restore dari offsite, plus mode gagal kunci salah, manifest
  rusak, dan berkas rusak;
- driver s3 + jangkar WORM: backup dari bucket dokumen uji (satu objek sengaja hilang), restore dari cloud ke MinIO
  sementara, dan jangkar WORM bertanda tangan sah yang tidak cocok → gagal di `audit_anchors`.

Tes ini butuh `docker compose up` dan `pnpm build`. Yang dipakai: database tes, awalan objek `uji-e2e-<acak>/`, bucket
`simrs-backups-offsite-uji`, dan bucket `simrs-dok-uji-*`/`simrs-jangkar-*-*`. Awalan dan bucket uji dihapus di akhir
tes.

## 7. Pemulihan sungguhan (bencana)

1. Siapkan server Postgres 16 baru dengan peran dari `infra/postgres/init.sql` (sandi produksi), plus peran
   `simrs_backup`.
2. Pemegang kunci membawa kunci privat (dan frasa sandi) ke mesin pemulihan.
3. Dekripsi ke folder **baru** (tidak pernah menimpa; manifest, checksum, dan kunci diperiksa lebih dulu):

   ```bash
   pnpm backup:dekripsi --sumber offsite --keluar /srv/pulih-20261005 --kunci-privat /media/usb-kunci/simrs-backup.key
   ```

4. Pulihkan ke database baru, lalu periksa:

   ```bash
   createdb -U postgres -O simrs_migrator -T template0 simrs_pulih
   pg_restore -U postgres -d simrs_pulih --exit-on-error --single-transaction /srv/pulih-20261005/db.dump
   MIGRATOR_DATABASE_URL=…/simrs_pulih pnpm --filter @simrs/db exec prisma migrate status
   ```

5. Kembalikan dokumen:
   - driver disk: salin `/srv/pulih-20261005/storage/` ke `STORAGE_DISK_ROOT`;
   - driver s3: unggah isi `storage/` (kunci = path relatif) ke bucket dokumen BARU, misalnya
     `mc mirror /srv/pulih-20261005/storage pulih/simrs-documents-pulih`. Arahkan `S3_BUCKET_DOCUMENTS` ke bucket itu.
     Pembacaan dokumen API memverifikasi sha256 setiap berkas terhadap barisnya.
6. Arahkan `DATABASE_URL` ke `simrs_pulih`, nyalakan API, lalu periksa `/ready` dan `/audit/verify`.
7. Hapus folder pulih (berisi plaintext). Catat insiden + RTO aktual (`downtime_incidents`, fase 10.6).
8. Bila PITR pgBackRest sudah terpasang, pakai PITR untuk menutup selisih sejak backup terakhir.

## 8. Kunci: kehilangan dan rotasi

- **Kehilangan satu salinan**: pakai salinan kedua untuk uji restore segera, lalu buat salinan baru.
- **Kehilangan kedua salinan**: backup lama tidak bisa dipulihkan. Buat pasangan kunci baru, ganti
  `BACKUP_PUBLIC_KEY`, jalankan backup manual + uji restore, lalu catat insiden.
- **Rotasi terjadwal** (mis. tahunan, atau saat pemegang berganti): buat kunci baru, lalu ganti `BACKUP_PUBLIC_KEY`.
  Kunci privat lama disimpan sampai backup terakhir yang memakainya keluar dari retensi (12 bulan).

## 9. Pemantauan dan bukti

- Platform (konteks tenant PLATFORM): `SELECT * FROM backup_runs ORDER BY finished_at DESC` dan `restore_tests`.
- RS: `app_backup_status()` dipetakan `backupStatusItems()` ke tiga baris layar Integrasi, mis.
  "Lokal server edge: 10.00 · berhasil" atau "Offsite terenkripsi: … · uji restore 29 Sep". Kata "terlambat"/"GAGAL"
  muncul bila salinan > 2 jam atau uji restore > 8 hari/gagal. Endpoint layar Integrasi tersambung di fase 7.

**Bukti uji restore** (mesin pengembang macOS, Docker OrbStack, 5 Okt 2026, database uji `simrs_test_backup`):

| Waktu (UTC)      | Backup                    | Sumber  | Isi                                               | Hasil                      | RTO   |
| ---------------- | ------------------------- | ------- | ------------------------------------------------- | -------------------------- | ----- |
| 2026-10-04 21:25 | `20261004T212510Z-hourly` | offsite | 40 tabel, 2.196 baris, 3 rantai audit             | berhasil, 14/14 langkah    | 18 dtk |
| 2026-10-05 00:08 | `20261005T000846Z-daily`  | offsite | 60 tabel, 4.645 baris, 20 rantai audit (1 sudah rusak di sumber: tenant uji pengrusakan) | berhasil, 14/14 langkah | 9 dtk |

Rincian run 5 Okt 00.08 (ms):

| `container` | `restore` | `migrations` | `api_ready` | `audit_verify` | lainnya |
| ----------- | --------- | ------------ | ----------- | -------------- | ------- |
| 3.632       | 2.639     | 721          | 1.077       | 391            | < 400 per langkah |

Sesudah driver s3 dan jangkar 10.8 masuk (5 Okt 2026 07.30 WIB), `test:pemulihan` 8/8 hijau dalam 81,6 dtk total.
Isinya dua backup penuh dan dua restore lengkap: disk + jangkar tabel dari offsite, dan s3 + jangkar WORM dari cloud
dengan MinIO sementara. Termasuk satu objek dokumen yang sengaja hilang di sumber dan dilaporkan sebagai temuan sumber.

Mode gagal terbukti di `test:pemulihan`: kunci privat lain berhenti di `key` (`KEY_MISMATCH`, tanpa kontainer), manifest
diubah (`MANIFEST_DIGEST_MISMATCH`) atau terpotong (`MANIFEST_INVALID`) berhenti di `manifest`, dan satu byte berkas
diubah berhenti di `checksum`, dan jangkar WORM bertanda tangan sah dengan hash lain berhenti di `audit_anchors`
(`ANCHOR_MISMATCH`). Database produksi jauh lebih besar; ulangi uji di perangkat keras pilot dan catat RTO
nyata di tabel ini (sasaran ≤ 4 jam).

## 10. Pemecahan masalah

| Gejala                                                         | Penyebab / tindakan                                                                           |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `pg_dump: server version mismatch`                             | `BACKUP_TOOLS=local` dengan pg_dump lama. Pakai `auto`/`docker`, atau pasang klien Postgres ≥ server |
| `PLATFORM_TENANT_REQUIRED` saat mencatat                       | tenant platform belum dibuat (`pnpm db:seed` atau `db:create-admin --tenant PLATFORM`)        |
| `permission denied for function app_record_backup_run`         | migrasi diterapkan sebelum peran ada: jalankan ulang `simrs-backup-role.sql` (§2)             |
| `cannot execute … in a read-only transaction`                  | wajar untuk peran backup di luar pencatatan (baca-saja bawaan)                                |
| `XMinioInvalidObjectName` / bucket tidak ada                   | `BACKUP_PREFIX` harus diakhiri `/`. Di lokal `BACKUP_ENSURE_BUCKETS=true`, atau `docker compose up minio-init` |
| Kontainer Docker tidak menjangkau Postgres/MinIO di Linux      | layanan harus mendengar di antarmuka yang terlihat dari `host.docker.internal` (host-gateway)  |
| `documents_db … sudah bermasalah di sumber`                    | objek s3 yang saat backup sudah hilang/berbeda dari barisnya (manifest `integrityErrors`, log backup `PERINGATAN`). Tinjau bersama pemilik P08 |
| `audit_anchors … ditolak` / `tanpa jangkar`                    | jangkar bertanda tangan kunci lain/palsu, atau job jangkar (10.8) belum berjalan sebelum backup. `ANCHOR_MISMATCH` = rantai hasil restore beda dari yang dijangkar: insiden audit |
| `documents_db … tanpa berkas`                                  | baris dokumen yang berkasnya tidak ada di `STORAGE_DISK_ROOT` sumber. Periksa sebelum memakai `--dokumen-ketat` |
