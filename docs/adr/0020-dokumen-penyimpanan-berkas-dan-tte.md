# ADR-0020 · Dokumen pasien: penyimpanan berkas lewat adapter, hash di DB, TTE lewat outbox, verifikasi QR publik

Status: diterima · 4 Okt 2026 · Komponen: P08 (katalog: dokumen dan tanda tangan elektronik)

## Konteks
Katalog P08 meminta penyimpanan dokumen dan lampiran (foto, hasil scan), TTE tersertifikasi, dan QR verifikasi. docs/05 meminta unggahan dibatasi tipe dan ukurannya, disimpan dengan nama acak, dan tanda tangan diverifikasi saat dibuka. ADR-0004 melarang menimpa entri final. Docker (MinIO) belum aktif di mesin pengembangan; pengguna memilih penyimpanan disk lokal dulu (4 Okt 2026).

## Keputusan
1. **Penyimpanan lewat antarmuka `ObjectStorage`.** Driver `disk` (folder `.local/storage`, juga cocok untuk server edge RS) dipakai sekarang. Driver `s3` (MinIO) menyusul dengan antarmuka yang sama; `STORAGE_DRIVER=s3` ditolak saat start sampai tersedia. Kunci objek selalu buatan server (`<tenant>/<tahun>/<bulan>/<uuid>`), divalidasi lagi oleh driver dan oleh CHECK database, jadi tidak ada path dari klien yang menyentuh sistem berkas. Berkas ditulis lewat berkas sementara + rename dan tidak boleh menimpa kunci yang ada.
2. **Jenis berkas dari isinya.** Hanya PDF, PNG, JPEG (magic bytes), maksimal 10 MB. Nama dan Content-Type kiriman klien diabaikan; nama berkas hanya untuk tampilan (disaring, ekstensi mengikuti isi). Unduhan selalu `attachment` dengan `nosniff` dan CSP `sandbox`.
3. **Unggahan berupa body biner yang dibaca middleware sebelum transaksi dibuka.** Dengan multer di interceptor, transaksi database sudah terbuka selama klien lambat mengunggah, sehingga koneksi pool bisa habis. Middleware `rawUpload` menolak permintaan tanpa token dan membuang body yang melewati batas; 413 dijawab setelah klien selesai mengirim (menjawab lebih awal membuat klien menerima reset koneksi). Metadata lewat header, karena judul dokumen bisa memuat PHI dan path/query lebih mudah tercatat di log proxy.
4. **Berkas ditulis sebelum baris metadata.** Bila transaksi batal, yang tersisa hanya berkas yatim tanpa metadata (dibersihkan job terjadwal kelak), tidak pernah metadata tanpa berkas.
5. **Integritas.** SHA-256 isi berkas disimpan saat unggah dan dicocokkan ulang setiap kali isi dibuka; berkas yang tidak cocok tidak diserahkan (`DOCUMENT_INTEGRITY`, dicatat log).
6. **Tidak pernah diubah atau dihapus (trigger).** Baris dokumen beku kecuali kolom pembatalan yang diisi sekali dengan alasan. Dokumen yang sedang atau sudah ditandatangani tidak bisa dibatalkan; perubahannya lewat addendum.
7. **TTE lewat outbox.** Permintaan tanda tangan mencatat `document_signatures` berstatus `pending` (hash dokumen + penanda tangan) dan pesan outbox berisi ID saja. Worker mengirim hash, bukan isi berkas, ke penyelenggara TTE (lokal: mock `/tte/sign`), lalu menyimpan sertifikat dan tanda tangan secara atomik dengan pencatatan terkirim. Trigger menjamin hash tanda tangan sama dengan hash dokumen, dokumen batal tidak bisa ditandatangani, dan tanda tangan terkunci setelah `signed`. Satu penanda tangan sekali per dokumen.
8. **Verifikasi QR publik tanpa PHI.** Kode `sv1.<tenant>.<acak 256 bit>` dicetak sebagai QR. Halaman `/verifikasi/<kode>` (tanpa login) hanya menampilkan RS, jenis dokumen, penanda tangan, waktu, sertifikat, dan hash. Kode disimpan apa adanya agar QR bisa dicetak ulang; acaknya mencegah penelusuran berurutan, dan isinya bukan rahasia.

## Konsekuensi
+ Dokumen bisa dipakai sekarang tanpa Docker; pindah ke MinIO cukup driver baru tanpa mengubah modul.
+ Berkas yang diubah di penyimpanan, path traversal, dan berkas berkedok (SVG/HTML berekstensi .pdf) tertolak.
− Driver S3/MinIO, pemindai virus (produksi), job pembersih berkas yatim, generator PDF + cetak QR (P12), dan layar dokumen di rekam medis klinis (fase 3) belum ada.
− Verifikasi kriptografis tanda tangan ke penyelenggara (rantai sertifikat) belum ada; halaman verifikasi menegaskan catatan tanda tangan dan kecocokan hash.
− Kegagalan permanen TTE (pesan DLQ) belum mengubah status tanda tangan; terlihat di outbox sampai Integration Hub (fase 7).

## Pembaruan 5 Okt 2026 · driver S3/MinIO

MinIO kini berjalan di Docker (`pgsty/minio`, bucket `simrs-documents` dan `simrs-backups`). Driver `s3` tersedia di balik antarmuka `ObjectStorage` yang sama; butir 1 di atas diperbarui sebagai berikut.

1. **Klien S3 minimal tanpa SDK.** `apps/api/src/infra/sigv4.ts` (AWS Signature V4, fungsi murni, diuji dengan vektor resmi AWS) dan `s3-client.ts` (`node:http`/`node:https`, gaya path `/<bucket>/<kunci>` yang cocok untuk MinIO dan S3-compatible lain). Hanya PutObject, GetObject, HeadBucket yang dipakai aplikasi, jadi `@aws-sdk/client-s3` tidak perlu dan tidak ada dependensi baru.
2. **Driver per lingkungan.** `STORAGE_DRIVER=s3` boleh di local, staging, dan produksi; `disk` hanya bila `APP_ENV=local` (mesin pengembang dan tes). Staging dan produksi wajib `s3`; driver tidak disetel berarti `disk`, sehingga API menolak start (gagal aman). Server edge RS memakai MinIO lokal, bukan disk.
3. **Tulis tanpa timpa, hash diverifikasi server.** PutObject memakai `If-None-Match: *` (kunci yang sudah ada ditolak server, tanpa jeda periksa-lalu-tulis), `x-amz-content-sha256` dan `x-amz-checksum-sha256` berisi SHA-256 yang juga dicatat di DB. Server menolak isi yang tidak cocok dan menyimpan checksum itu bersama objek. Antarmuka tidak punya operasi hapus.
4. **Unduhan di-stream, tetap terverifikasi.** GetObject meminta checksum objek (`x-amz-checksum-mode: ENABLED`). Ukuran dan checksum dibandingkan dengan DB sebelum byte pertama dikirim. Isi di-hash ulang selama stream dan potongan terakhir ditahan sampai hash cocok; bila tidak cocok, koneksi diputus (`Content-Length` tidak terpenuhi), jadi berkas rusak tidak pernah diterima utuh. Objek tanpa checksum (mis. disalin di luar aplikasi) dan driver disk dibaca utuh (≤ 10 MB) lalu di-hash sebelum dikirim. Klien yang memutus unduhan langsung melepas koneksi ke penyimpanan.
5. **Kunci dan log tanpa PHI.** Kunci tetap `<tenant>/<tahun>/<bulan>/<uuid>` dan divalidasi driver sebelum ke jaringan. Galat S3 hanya membawa status dan kode (`NoSuchKey`, `PreconditionFailed`), tanpa kunci, bucket, atau kredensial; log dokumen hanya memuat ID dokumen.
6. **Kesiapan lewat HeadBucket.** `/ready` memeriksa bucket dokumen dengan HeadBucket (berlaku untuk S3 mana pun), bukan endpoint kesehatan khusus MinIO.
7. **Transaksi.** PutObject terjadi di dalam transaksi permintaan (butir 4: berkas sebelum metadata), dibatasi 10 MB dan batas diam soket 15 detik; satu koneksi DB tertahan selama unggah ke penyimpanan. GetObject membuka stream di dalam transaksi, isinya dikirim setelah commit.

Konsekuensi:
+ Berkas dokumen di staging/produksi tidak lagi bergantung pada disk server API; checksum tersimpan di penyimpanan dan di DB.
+ Tes integrasi memakai MinIO lokal di bucket uji `simrs-test-<acak>` yang dibuat dan dihapus tes; suite API dokumen dijalankan untuk kedua driver. `pnpm --filter @simrs/api test` kini butuh MinIO (`docker compose up -d`), seperti Redis.
− Produksi perlu kredensial khusus aplikasi (bukan root MinIO) dengan izin `s3:PutObject`, `s3:GetObject`, dan `s3:ListBucket` (untuk HeadBucket) saja, tanpa `s3:DeleteObject`; object lock/versioning (WORM) di bucket dokumen dan endpoint TLS dianjurkan. Belum ditegakkan kode.
− Hanya gaya path; virtual-hosted style dan unggah multipart (berkas > 10 MB) belum ada. Alat pindah berkas dari disk lokal ke S3 belum ada (data lokal fiktif, cukup di-seed ulang).
