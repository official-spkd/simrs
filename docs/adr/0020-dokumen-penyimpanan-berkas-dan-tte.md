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
