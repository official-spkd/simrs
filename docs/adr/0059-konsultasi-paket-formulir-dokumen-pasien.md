# ADR-0059 · Konsultasi, rawat bersama, paket formulir, dan dokumen pasien klinis

Tanggal: 7 Oktober 2026 · Status: diterapkan pada potongan 3.8 (K10, K15, utang P08). Nomor dari blok cadangan fase 3–7.

## Konteks

Rencana fase 3 §3.8 meminta konsultasi dengan jawaban terstruktur, ganti DPJP utama sebagai versi baru (relasi akses ikut), paket formulir per setting dengan kelengkapan (EP 6b/7a), dan komponen dokumen pasien. Skema 3.0b sudah menyediakan `consult_requests`/`consult_responses` berversi, `encounter_participants` (satu DPJP utama aktif), dan `form_packages`. Layar demo Konsultasi menetapkan aturan: hanya dokter tujuan yang menjawab, pengirim tidak menjawab konsulnya sendiri, cito ≤ 1 jam, biasa ≤ 24 jam, dan konsultan memperoleh akses berbatas waktu.

## Keputusan

1. **Tanpa migrasi baru.** Konsultasi memakai tabel 3.0b lewat `ClinicalRecordService`, sehingga koreksi, addendum, salah entri, penulis dari sesi, dan penanda terlambat mengikuti ADR-0028.
2. **Pengirim** = penugasan `dokter` atau `dokter_residen` (`clinical.write`). Tujuan = dokter aktif tertentu (bukan diri sendiri) dan/atau unit. Pertanyaan minimal 20 karakter. Urgensi `segera` (cito) atau `biasa` menentukan `dueAt`.
3. **Penjawab hanya konsultan.** Bila ada dokter tujuan, hanya dokter itu yang menjawab. Bila tujuan hanya unit, penjawabnya dokter yang bertugas di unit itu. Penjawab harus berperan `dokter` (residen tidak) dan bukan pengirim; selain itu 403 `CONSULT_NOT_RECIPIENT`. Pemeriksaan ini mendahului pembukaan data pasien. Satu rantai jawaban per permintaan, perubahan lewat revisi. Kunci advisory per permintaan mencegah jawaban ganda.
4. **Akses berbatas waktu.** Dokter tujuan mendapat `access_relationships` `konsultan` (sumber `consult_request`) selama 24 jam sejak permintaan. Dokter unit mendapatkannya saat menjawab. Konsul sekali yang dijawab membatasi akses sampai 24 jam setelah jawaban.
5. **Rawat bersama / alih rawat** yang diterima mengubah tim perawatan lewat `CareTeamService`. Rawat bersama menambah anggota `rawat_bersama`. Alih rawat mengakhiri DPJP utama lama (relasinya berlaku sampai akhir hari berikutnya, ADR-0031) dan menjadikan penjawab DPJP utama. Serah DPJP utama langsung (`POST /encounters/:id/care-team/primary`) hanya oleh DPJP utama aktif, dengan alasan ≥ 10, ke dokter aktif.
6. **Biaya dan notifikasi.** Jawaban pertama mencatat `billable_events` `konsultasi` sekali per rantai. Notifikasi permintaan dan jawaban tidak memuat PHI.
7. **Paket formulir** dibaca `forms.definition.read` dan diubah `forms.definition.write`. Kelengkapan kunjungan (`GET /encounters/:id/completeness`) memetakan kelas kunjungan ke setting (AMB → rawat jalan, EMER → IGD, IMP → rawat inap). Kelengkapan = setiap formulir wajib aktif punya isian final terkini dengan `encounterId` kunjungan itu. Rute kanonik per kunjungan dipakai menggantikan `/assessment/encounters/:id/completeness` di rencana.
8. **Dokumen pasien di layar klinis** memakai API P08 yang sudah ada (daftar, unggah biner, batal beralasan, minta TTE) lewat BFF web. Unduhan diteruskan Route Handler, sehingga token tetap di server.

## Pembaruan 7 Oktober 2026 · Sambungan layar

- Tab "Dokumen & konsultasi" Rawat inap (W4) memuat kelengkapan paket rawat inap, konsul + jawaban, tim perawatan, dan dokumen pasien; tiap bagian hanya bila sesi memegang izinnya (403/404 = bagian disembunyikan).
- Layar Konsultasi hibrida (izin layar `clinical.write`): kotak masuk konsultan dan, dengan `?kunjungan=`, panel konsul + tim yang sama dengan tab Rawat inap. Pilihan dokter tujuan dari `GET /consults/consultants` (dokter aktif + unit, tanpa data pasien).
- Layar Paket layanan hibrida (izin layar `forms.definition.read`): mode api = paket formulir per setting, diubah pemegang `forms.definition.write`. Paket layanan khusus (HD/kemo/ANC) tetap mode presentasi.

## Pembaruan 7 Oktober 2026 · Pencarian konsultan (temuan agen BUG)

Daftar konsultan semula dibatasi 500 penugasan tanpa urutan, sehingga di RS dengan lebih banyak penugasan dokter
sebagian dokter hilang acak dari pilihan. Kini `GET /consults/consultants` adalah pencarian: `q` (≥ 2 huruf, nama dokter
atau nama unit, tidak peka huruf besar), `unitId`, `limit` (bawaan 20, maks. 50); disaring dan dibatasi per pengguna di
database dengan urutan nama → id. Pemilih "Dokter konsultan" dan "Dokter penerima" di layar mencari di server
(`searchConsultantsAction`), tidak lagi memuat seluruh dokter.

## Pembaruan 7 Oktober 2026 · Unggah berkas lewat Route Handler (tinjauan keamanan DOC)

Unggah dokumen pasien dipindah dari Server Action ke Route Handler `POST /klinis/dokumen/unggah` yang memeriksa asal
permintaan, sesi, dan izin sebelum membaca body, lalu membatasi 10 MB + jenis dari isi seperti API. Batas body Server
Action kembali bawaan (1 MB); gambar tanda tangan tablet dibatasi 256 KB per gambar di web.

## Konsekuensi

- Kode galat baru `CONSULT_NOT_RECIPIENT` (403).
- Layar demo Konsultasi dan Paket layanan tetap mode presentasi. Sambungan mode api untuk konsultasi menjadi bagian layar Rawat inap (W4) atau layar Konsultasi pada gelombang berikutnya.
- Akses konsultan yang kedaluwarsa tidak diperpanjang otomatis. Konsultan yang masih perlu membuka rekam memakai rawat bersama atau akses darurat yang tercatat.
