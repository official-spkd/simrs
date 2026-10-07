# ADR-0029 · PDF klinis deterministik (pdf-lib + fontkit + IBM Plex) di atas alur dokumen dan TTE

Status: diterima · 5 Okt 2026 · Komponen: P12 (minimal), P08, K11, K13

## Konteks

Fase 3 butuh dokumen legal yang ditandatangani TTE tersertifikasi: resume medis rawat jalan dan rawat inap (K13), persetujuan dan penolakan tindakan (K11), dan resep (K09). Rencana fase 3 (§3.1, keputusan no. 2 dan 3) menetapkan PDF dibuat di server dengan `pdf-lib` + fontkit + IBM Plex, deterministik, lalu masuk alur dokumen yang sudah ada sejak fase 1 (ADR-0020): `documents` → `document_signatures` `pending` → outbox `tte.sign` → worker → penyelenggara TTE, dengan `onDead` menandai TTE gagal.

Yang ditandatangani TTE adalah SHA-256 berkas (ADR-0020 butir 7). Hash itu harus bisa dibangun ulang dari rekam medisnya: bila isi rekaman yang sama menghasilkan berkas berbeda (jam render, ID acak, nama fon acak), auditor tidak bisa membuktikan bahwa PDF yang ditandatangani memang mewakili data di basis data. Generator PDF dan cetak QR juga tercatat sebagai utang ADR-0020.

## Keputusan

1. **Paket `@simrs/pdf` (`packages/pdf`).** Mesin PDF dipakai API (menerbitkan) dan worker (tes ujung ke ujung; kelak cetak ulang/arsip), jadi ditaruh di paket tersendiri seperti `@simrs/db`, dibangun tsup ke ESM + CJS. Tidak di `@simrs/shared/node`, agar pdf-lib dan berkas fon tidak ikut ke setiap pemakai shared (web, mock). Dependensi baru: `pdf-lib` 1.17.1, `@pdf-lib/fontkit` 1.1.1, `uqr` 0.1.3 (sudah dipakai web untuk QR), `@ibm/plex-sans` dan `@ibm/plex-mono` 1.1.0. Semua versi dikunci persis.
2. **Fon IBM Plex (SIL OFL 1.1)** sama dengan layar (docs/08): Sans Regular dan SemiBold, serta Mono untuk NIP/kode. Berkas WOFF dibaca dari paket npm (bukan disalin ke repo), lalu disubset dan ditanam sebagai TrueType (`FontFile2`) dengan peta `ToUnicode`, sehingga teks bisa disalin dan dicari. Skrip pasang paket fon (telemetri) dimatikan di `pnpm-workspace.yaml`.
3. **Deterministik.**
   - Renderer tidak membaca jam. Waktu terbit (`issuedAt`) wajib dari pemanggil, yaitu waktu final rekaman klinisnya. Nilai itu yang tampil (WIB) dan menjadi `CreationDate`/`ModDate`.
   - Metadata otomatis pdf-lib dimatikan (`updateMetadata: false`). Producer/Creator bernilai tetap.
   - Nama fon tetap (`customName`), tanpa akhiran acak. RNG internal pdf-lib berbenih tetap, dan object stream tidak dipakai.
   - Hasilnya: input sama → byte sama → SHA-256 sama. Versi paket fon dan pdf-lib ikut menentukan byte, jadi pembaruan versinya adalah perubahan yang disengaja: hash dokumen lama tetap sah karena berkasnya tersimpan.
4. **Templat dasar dokumen klinis** (`renderClinicalPdf`, A4):
   - Kop RS: nama tenant, fasilitas aktif pertama, dan alamat.
   - Judul, nomor dokumen, dan waktu terbit.
   - Bingkai identitas pasien: nama, RM, tanggal lahir, jenis kelamin, dan baris tambahan dari pemanggil.
   - Bagian isi dengan blok `paragraph`, `fields`, `list`, `table`.
   - Blok tanda tangan: penanda tangan TTE mendapat QR URL verifikasi publik, penanda tangan lain (pasien, wali, saksi) mendapat garis tanda tangan.
   - Kaki "Halaman x dari y" di setiap halaman. Halaman lanjutan mengulang nama dan RM pasien.
   - Isi divalidasi zod sebelum dirender.
5. **Kode verifikasi dibuat sebelum render.** QR dicetak di dalam PDF, jadi `verify_code` (ADR-0020 butir 8) dibangkitkan lebih dulu, dimasukkan ke PDF, lalu hash dihitung atas berkas yang sudah memuat QR. Kode yang sama disimpan di `document_signatures`. Dengan kode itu, PDF tetap bisa dibangun ulang byte demi byte.
6. **`ClinicalPdfService.issue` di modul dokumen** (diekspor `DocumentsModule`, dipanggil modul klinis di transaksi permintaannya). Urutannya:
   - Periksa ABAC pasien. Rekam medis yang sudah digabung → 409.
   - Ambil identitas pasien dan kop dari DB, bukan dari klien.
   - Render, simpan berkas (berkas sebelum metadata, ADR-0020 butir 4), tulis baris `documents`, audit `create`.
   - Bila diminta, catat TTE `pending` untuk pengguna sesi + outbox `tte.sign` + audit `sign` (`DocumentsService.recordSignatureRequest`, dipakai juga oleh permintaan TTE manual).
   - Izin tanda tangan (`clinical.sign`, `consent.sign`) diperiksa endpoint pemanggil, bukan oleh layanan ini.
7. **Hasil TTE tetap lewat worker yang ada** (`outbox/tte.ts`):
   - 2xx → `signed` (sertifikat dan tanda tangan disimpan atomik).
   - 4xx dari penyelenggara (ditolak) → langsung DLQ, lalu `onDead` mengubah tanda tangan menjadi `failed` + audit `sign` berstatus `failed`.
   - 5xx atau timeout → dicoba ulang dengan backoff, tanda tangan tetap `pending`.
   - Tidak ada tabel atau kolom baru.

## Konsekuensi

- \+ Dokumen legal fase 3 tinggal memanggil satu layanan. Hash yang ditandatangani bisa dibuktikan dari data (tes API membangun ulang PDF dan mencocokkan hash).
- \+ Teks Indonesia (°, µ, ², ≤, ≥, ×, ·, →) tertanam dengan fon yang sama di semua mesin, tidak bergantung fon sistem server.
- − Ukuran berkas ±60–90 KB per dokumen karena tiga subset fon. Satu fon per gaya cukup untuk saat ini.
- − PDF/A, tanda tangan PAdES di dalam berkas (TTE tersertifikasi di sini atas hash, ADR-0020), dan watermark "SALINAN" untuk cetak ulang belum ada.
- − Gambar (logo RS, tanda tangan tulisan tangan PNG dari tablet ADR-0020) belum didukung templat. Penanda tangan non-TTE untuk sementara tampil sebagai nama di bawah garis tanda tangan.
- − `@ibm/plex-*` 1.1.0 hanya memuat WOFF/WOFF2. Bila suatu saat fontkit gagal membaca WOFF, gantinya berkas TTF resmi yang disalin ke `packages/pdf` beserta lisensi OFL.

## Pembaruan 7 Okt 2026 · penutup fase 3 (potongan 3.9)

- **Pemakai** (semua dokumen klinis legal lewat `ClinicalSigningService.issueSigned`, kunci advisory versi sumber):
  resume medis + addendum dan surat keterangan kematian (3.6, ADR-0093), persetujuan/penolakan/pencabutan tindakan
  (3.7, ADR-0058). Resep (3.4) tetap `ClinicalPdfService.issue` dengan sumber `order_groups` (bukan entri berversi);
  TTE-nya hanya bila penulis memegang `clinical.sign`.
- **TTE gagal** (`failed` lewat `onDead`) tidak mengunci versi dan tidak dihitung `DischargeGate`; layar Resume
  menampilkan "Tanda tangani ulang (TTE)" (resume dan surat kematian) yang membuat versi koreksi beralasan dengan PDF +
  permintaan TTE baru. Worklist DPJP tetap memuat tugas `tte_failed`.
- **Cetak** dokumen klinis dari layar memakai rute BFF bersama `/klinis/dokumen/:id/unduh` (cek same-origin, izin
  `documents.read`, hash dicek API, pembukaan diaudit).
