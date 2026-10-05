# ADR-0071 · Backup terenkripsi tiga lokasi dan uji restore di kontainer bersih

Status: diterima · 5 Okt 2026 · diperbarui 5 Okt 2026 · Komponen: P13, infra (P01 untuk catatan platform) · Fase 10 potongan 10.7

## Konteks
MRMIK 5 dan `docs/01-arsitektur.md` meminta backup di tiga lokasi (edge RS, cloud utama, salinan terenkripsi di
lokasi lain) dengan uji restore terjadwal. NFR usulan: RPO ≤ 15 menit, RTO ≤ 4 jam (`docs/05-keamanan.md`). Rencana
fase 10 (§4 keputusan 7) memilih `pg_dump -Fc` + `age` ke kunci publik, peran `simrs_backup` khusus kontainer ops, uji
restore mingguan di kontainer bersih, dan pgBackRest PITR untuk produksi.

Kendala saat dibangun:
- Biner/image `age` tidak tersedia dan tidak boleh diunduh dari sumber tak tepercaya; image ops dengan `apk add age
  nodejs` juga butuh jaringan saat build.
- `pg_dump` di host bisa lebih tua dari server (di Mac pengembang: 14 vs server 16) dan pg_dump menolak server baru.
- Migrator tidak punya `CREATEROLE`, dan `BYPASSRLS` hanya bisa diberikan superuser.
- Dua aplikasi menulis selama backup; jumlah baris di manifest harus persis sama dengan isi dump.

## Keputusan
1. **Skrip Node di host ops, bukan profil compose.** Paket workspace `infra/backup` (`@simrs/backup`, TypeScript, tanpa
   dependensi baru): `pnpm backup:jalankan`, `backup:uji-restore`, `backup:dekripsi`, `backup:kunci-baru`. `pg_dump`
   dan `mc` memakai biner lokal bila ada dan versinya ≥ server, selain itu image resmi yang sudah dipakai repo
   (`postgres:16-alpine`, `pgsty/mc`) lewat `docker run --rm`. Semua proses anak tanpa shell; rahasia (kata sandi DB,
   kunci S3, `MC_HOST_*`) hanya lewat variabel lingkungan dan disamarkan di pesan galat. Image ops produksi (Node +
   klien Postgres 16 + mc) dibuat saat infrastruktur produksi ada, menjalankan skrip yang sama.
2. **Peran `simrs_backup`**: `LOGIN BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE CONNECTION LIMIT 4`, anggota
   `pg_read_all_data`, tanpa hak tulis tabel, `default_transaction_read_only = on`. Dibuat superuser: `init.sql` untuk
   volume baru, `infra/backup/sql/simrs-backup-role.sql` untuk cluster yang sudah ada. Migrasi hanya memberi `EXECUTE`
   fungsi pencatat. Tidak pernah dipakai aplikasi; tes memastikan `simrs_app` bukan anggotanya dan tidak bisa
   `SET ROLE` ke sana. Ini satu-satunya pengecualian BYPASSRLS, dan hanya di luar runtime aplikasi.
3. **Konsistensi**: kunci advisory sesi (`simrs:backup`) mencegah dua backup tumpang tindih lintas host. Satu transaksi
   `REPEATABLE READ READ ONLY` mengekspor snapshot (`pg_export_snapshot()`). Jumlah baris per tabel, daftar migrasi,
   dan kepala rantai audit per tenant dibaca di snapshot itu, lalu `pg_dump --snapshot` membaca snapshot yang sama.
   Berkas dokumen diarsipkan setelahnya; berkas ditulis sebelum barisnya commit dan tidak pernah dihapus, jadi semua
   berkas yang dirujuk dump ikut terarsip.
4. **Enkripsi kunci publik dengan `node:crypto`** (pengganti `age`, konstruksinya meniru `age`): per berkas kunci
   X25519 efemeral → ECDH ke kunci penerima → HKDF-SHA256 (garam acak, header + kunci penerima di info) →
   AES-256-GCM per potongan 64 KiB, nonce = penghitung + bendera potongan terakhir (STREAM). Header 65 byte memuat id
   kunci penerima. Pemotongan, penukaran potongan, perubahan satu bit, dan header palsu gagal autentikasi. Host backup
   hanya memegang kunci **publik** (`BACKUP_PUBLIC_KEY`, `simrsbk1:…`), jadi tidak bisa membaca backup yang ia buat.
   Kunci privat (PKCS#8, boleh terenkripsi frasa sandi) disimpan offline dalam dua salinan oleh dua pemegang. Dengan
   frasa sandi, pemegang berkas dan pemegang frasa bisa orang berbeda (kendali dua orang). Plaintext dump dan arsip
   tidak pernah menyentuh disk host backup: keduanya dialirkan langsung ke enkripsi.
5. **Isi satu backup** (folder `<UTC yyyymmddThhmmssZ>-<hourly|daily|manual>`):
   - `db.dump.enc`;
   - `documents.tar.enc`: ustar yang ditulis/dibaca sendiri, hanya kunci penyimpanan `<tenant>/<tahun>/<bulan>/<uuid>`,
     jadi path traversal tidak mungkin;
   - `manifest.json`, polos dan tanpa PHI: SHA-256 + ukuran setiap berkas sebelum/sesudah enkripsi, jumlah baris per
     tabel, migrasi, kepala rantai audit, tenant, id kunci penerima, dan `digest` = SHA-256 JSON kanonik seluruh isi.
   Manifest ditulis paling akhir; adanya manifest = backup lengkap.
6. **Tiga lokasi**:
   1. disk edge `BACKUP_LOCAL_DIR` (`.local/backup`);
   2. bucket `simrs-backups/<BACKUP_PREFIX><kunci>`, unggah dua tahap (data dulu, manifest terakhir);
   3. `mc mirror` seluruh awalan ke bucket `simrs-backups-offsite`, inkremental, tanpa `--remove`, sehingga
      penghapusan di bucket utama tidak merambat dan run lama yang gagal tersalin ikut pulih.
   Produksi memakai penyedia/region lain untuk offsite (`BACKUP_OFFSITE_S3_*`) dan object lock.
   Status run: `success` (tiga lokasi), `partial` (disk lokal ada, lokasi jauh gagal; kode keluar 2), `failed`.
7. **Retensi** per lokasi, dihitung terpisah dengan fungsi murni yang dites:
   - 48 per jam, 35 harian, 12 bulanan (harian terbaru tiap bulan UTC), 10 manual;
   - backup lengkap terbaru dan run yang sedang berjalan selalu disimpan;
   - folder tanpa manifest dihapus setelah 24 jam;
   - nama asing tidak disentuh.
   Di bucket ber-object-lock, retensi WORM penyedia yang menang; penghapusan yang ditolak dilaporkan, tidak menggagalkan
   backup.
8. **Jadwal**: cron/systemd timer di host ops. Per jam di menit 05, harian 01.30 WIB, uji restore mingguan (Minggu
   03.00) dari bucket utama, dan uji dari offsite sebulan sekali. Bukan job worker aplikasi, agar peran BYPASSRLS tetap
   di luar runtime aplikasi.
9. **Uji restore** (`pnpm backup:uji-restore`). Urutannya dari yang tidak membuat apa pun:
   1. pilih backup lengkap terbaru, lalu ambil berkasnya;
   2. manifest: rusak/diubah = **gagal keras**;
   3. checksum berkas terenkripsi;
   4. kunci privat harus cocok dengan id di manifest dan header. **Kunci salah gagal di sini**, sebelum ada plaintext,
      kontainer, atau berkas yang ditimpa;
   5. dekripsi ke folder kerja baru 0700, hash plaintext harus cocok;
   6. ekstrak dokumen;
   7. kontainer `postgres:16-alpine` bersih dengan `init.sql` (peran sama dengan produksi) + Redis;
   8. `pg_restore --single-transaction --exit-on-error` ke DB baru;
   9. `prisma migrate status` + daftar migrasi = manifest;
   10. jumlah baris setiap tabel = manifest;
   11. baris `documents` ↔ berkas (peringatan; gagal dengan `--dokumen-ketat`);
   12. API hasil build menyala di port acak loopback di atas DB hasil restore: `/ready` 200 (DB, Redis, folder
       dokumen hasil ekstrak), lalu `/audit/verify` per tenant aktif;
   13. kepala rantai audit = manifest, ditambah `app_verify_audit_chain()` untuk semua tenant.
   RTO terukur = mulai sampai langkah terakhir lolos. Hasil per langkah dicatat ke `restore_tests` DB sumber dan
   laporan JSON. Kontainer, proses API, dan plaintext selalu dihapus (kecuali `--simpan-kontainer`).
10. **API uji memakai mode header pengembang** (`APP_ENV=local`, `ALLOW_DEV_TENANT_HEADER=true`) agar `/audit/verify`
    bisa dipanggil per tenant tanpa akun. Ini hanya untuk uji: proses terikat 127.0.0.1, port acak, DB buangan, dan
    dimatikan begitu uji selesai. Mesin uji restore sudah memegang kunci privat (bisa membaca semuanya), jadi risikonya
    tidak bertambah.
11. **Pencatatan**: `backup_runs` dan `restore_tests` milik tenant PLATFORM, `FORCE` RLS + `tenant_isolation` seperti
    tabel domain lain, append-only (trigger, juga untuk pemilik). Hanya ditulis lewat `app_record_backup_run()` /
    `app_record_restore_test()` (SECURITY DEFINER, `search_path = public, pg_temp`). Fungsi menyetel konteks tenant
    platform selama kerjanya, lalu memulihkan konteks pemanggil. EXECUTE hanya untuk `simrs_backup`. RS membaca
    `app_backup_status()` (pola ADR-0008): hanya waktu + status per lokasi, jumlah gagal 24 jam, dan uji restore
    terakhir + RTO; tanpa nama bucket/path, kunci, ukuran, atau teks galat. `readBackupStatus()` (db) dan
    `backupStatusItems()` (shared) memetakannya ke kontrak `backups` layar Integrasi; endpoint dan izin
    `backup.read` menyusul di fase 7.
12. **Pemulihan sungguhan**: `pnpm backup:dekripsi --keluar <folder baru>` menjalankan langkah 1–6 di atas lalu
    menulis `db.dump` + `storage/` ke folder yang belum ada. `pg_restore` ke server produksi dan pemindahan
    penyimpanan dokumen tetap langkah operator yang disengaja (runbook).
13. **RPO**: backup per jam memberi RPO ≤ 1 jam. RPO 15 menit di produksi lewat pgBackRest (WAL archive + PITR) ke
    bucket yang sama, dipasang bersama infrastruktur produksi (keputusan fase 10 no. 13). Uji restore mingguan tetap
    memakai dump ini.

## Konsekuensi
+ Restore terbukti end-to-end di kontainer bersih: tes `test:pemulihan` dan runbook mencatat RTO terukur.
+ Host backup yang dibobol tidak membuka isi backup lama. Satu berkas yang rusak terdeteksi sebelum dekripsi.
+ Tanpa dependensi atau biner baru. Mesin Mac/Linux/Windows cukup Node + Docker.
− Format enkripsi buatan sendiri (konstruksi standar, diuji). Kehilangan kode ini tidak menghilangkan kemampuan dekripsi
  karena formatnya terdokumentasi di `infra/backup/src/crypto.ts`. Bila `age` tersedia kelak, migrasi format = backup
  baru memakai `age`; versi format ada di header.
− Manifest tidak bertanda tangan: enkripsi kunci publik tidak mengautentikasi pengirim. Integritas terhadap penyerang
  yang bisa menulis ke bucket bergantung pada hak akses bucket + object lock (produksi). Jangkar audit WORM (ADR-0072)
  menjadi pembanding independen.
− Kehilangan kedua salinan kunci privat = backup tak terpulihkan. Mitigasinya prosedur dua pemegang dan uji restore
  berkala (yang gagal bila kunci hilang).
− Jumlah baris `count(*)` per tabel menambah beban baca pada DB besar. Bila perlu, ganti ke statistik + sampel tanpa
  mengubah format manifest.

## Pembaruan 5 Okt 2026 · Dokumen driver s3 dan pembanding jangkar audit WORM

Driver S3 P08 (agen I) dan jangkar audit 10.8 (ADR-0072) sudah masuk master.

1. **Dokumen s3 di-backup per baris.** Dengan `STORAGE_DRIVER=s3`, daftar objek = baris `documents` (kunci + sha256 +
   ukuran) di snapshot yang sama dengan dump. Objek di luar baris (yatim) sengaja tidak ikut.
   - Setiap objek di-GET dari `S3_BUCKET_DOCUMENTS` dan dialirkan langsung ke ustar terenkripsi; plaintext tetap tidak
     menyentuh disk host backup.
   - Ukuran header = `content-length` objek. Hash dihitung saat lewat, lalu dicocokkan dengan baris.
   - Objek hilang, ukuran beda, atau hash beda dicatat di manifest `documents.integrityErrors` (kunci + alasan, tanpa
     PHI) dan log `PERINGATAN`. Backup tetap berjalan dan menyalin apa adanya, karena temuan sumber bukan kegagalan
     backup.
   - Driver disk tidak berubah. Manifest `documents.source` = `disk` | `s3`.
2. **Uji restore dokumen s3** memakai kontainer `pgsty/minio` sementara (kredensial acak, port loopback acak, dihapus
   bersama kontainer lain), jadi bucket yang sedang dipakai tidak pernah disentuh.
   - Objek hasil ekstrak diunggah ke bucket baru dengan `x-amz-checksum-sha256`, yang diverifikasi server.
   - Langkah `documents_db` mencocokkan setiap baris dengan berkas hasil ekstrak (ukuran + SHA-256) dan dengan checksum
     objek di bucket sementara.
   - Untuk s3, selisih apa pun di luar `integrityErrors` = gagal.
   - API uji menyala dengan `STORAGE_DRIVER=s3` ke bucket itu, sehingga `/ready` memeriksa bucket.
3. **Langkah `audit_anchors`** (sesudah `audit_verify`), per tenant ber-audit:
   - Pakai jangkar sah **terbaru dengan `anchoredAt` ≤ waktu mulai backup**.
   - Sumber utama bucket WORM `AUDIT_ANCHOR_BUCKET`, di luar dump sehingga pembandingnya independen. Tanpa bucket:
     tabel `audit_anchors` hasil restore, dan laporan menyebut sumbernya.
   - Dengan `AUDIT_ANCHOR_KEY`, HMAC dan id kunci diperiksa: jangkar palsu atau berkunci lain dilewati dan dihitung
     "ditolak", tidak dipercaya. Tanpa kunci, tanda tangan tidak dinilai, dan laporan menyebutnya.
   - Syarat lolos: baris di seq jangkar ada dengan hash sama (`ANCHOR_MISMATCH`), kepala rantai hasil restore tidak di
     bawah seq jangkar (`TRUNCATION_DETECTED`), dan rantai bersambung dari jangkar (`app_verify_audit_chain_from`,
     `CHAIN_BROKEN`; dilewati untuk rantai yang menurut manifest sudah rusak di sumber).
   - Penyederhanaan: daftar WORM memakai ListObjectsV2 (versi terbaru) + verifikasi HMAC, bukan ListObjectVersions
     "versi pertama" seperti job 10.8. Versi tambahan berisi isi palsu tetap ditolak HMAC.
4. **Klien S3 bersama.** `S3Client` + SigV4 dipindah dari `apps/api/src/infra` ke `@simrs/shared/node`
   (`src/s3/`), ditambah `listObjects()` (ListObjectsV2 berhalaman). Berkas lama di API tinggal re-ekspor; perilaku
   tidak berubah. Salinan worker (`apps/worker/src/audit/s3-lite.ts`) belum disatukan.

5. **Perbaikan:** kepala rantai audit di manifest kini dipilih dengan urutan **numerik** seq. Kueri awal mengurutkan
   alias `seq::text` secara leksikal ("9" > "52"). Uji restore lama tetap konsisten (membandingkan baris yang sama di
   sumber dan hasil restore), tetapi "kepala" bisa bukan baris terakhir. Tes e2e kini mengunci kepala = seq terbesar.

Konsekuensi tambahan: backup s3 membaca semua objek dokumen setiap run. Untuk volume besar, backup per jam bisa
dibatasi ke dump saja dengan dokumen harian; itu keputusan NFR produksi, belum dibuat.
