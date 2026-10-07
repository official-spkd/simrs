# ADR-0058 · Persetujuan tindakan: draf tablet, atestasi saksi, final ber-TTE

Tanggal: 7 Oktober 2026 · Status: diterapkan pada potongan 3.7 (K11). Nomor dari blok cadangan fase 3–7.

## Konteks

Rencana fase 3 §3.7 meminta templat P07 tujuh butir, draf, tanda tangan pasien/wali + saksi (PNG atau ketik nama), atestasi saksi petugas, final hanya dokter (`consent.sign`) menjadi PDF + TTE, penolakan beralasan, pencabutan sebagai versi baru, dan edukasi lewat P07. Tabel `consents` + `consent_signatures` (3.0b) adalah entri klinis berversi final: tidak ada status draf. Tablet (W5a) butuh dokumen ber-ID stabil yang dibuka beberapa orang berurutan: dokter/perawat menyiapkan, pasien menandatangani, saksi petugas beratestasi dari sesinya sendiri, dokter memfinalkan. Draf klinis umum (`clinical_drafts`) hanya milik penulisnya, sehingga tidak cocok untuk alur multi-pengguna ini.

## Keputusan

1. **Draf terpisah dari rekam medis.** Tabel baru `consent_drafts` (migrasi `20261007200000_consent_drafts`) menyimpan isi kerja: templat, tindakan, pemberi persetujuan, tujuh butir, tanda tangan (JSON), saksi petugas, status `draf | final | ditolak | batal`, dan rujukan ke entri `consents` hasilnya. Tabel memakai RLS FORCE + `tenant_isolation`, FK komposit, hak SELECT/INSERT + UPDATE kolom kerja (tanpa DELETE).
2. **Tutup-sekali di database.** Trigger `consent_drafts_guard` menolak perubahan setelah status keluar dari `draf` (`CONSENT_CLOSED`, juga bagi pemilik tabel) dan penghapusan. Trigger yang sama mengisi `signed_at`, `staff_witnessed_at`, `closed_at` dari jam server. CHECK memastikan `final` hanya dengan tanda tangan + atestasi, `batal` hanya dengan alasan ≥ 10.
3. **Urutan bukti.** Ganti isi → tanda tangan dan atestasi dihapus. Ganti tanda tangan → atestasi dihapus. Atestasi hanya setelah tanda tangan. Pasien/wali menyatakan memahami ketujuh butir (`acknowledged`) saat menandatangani.
4. **Izin.** `consent.write` (dokter, perawat, bidan; lingkup unit) menyiapkan draf, mengambil tanda tangan, menjadi saksi, dan membatalkan. `consent.sign` (hanya dokter, lingkup relasi) memfinalkan, menolak, dan mencabut. Izin diperiksa di endpoint (`@RequirePermission`), ABAC pasien di service. Saksi petugas harus orang lain dari dokter yang memfinalkan, dan atestasinya berlaku 30 menit.
5. **Final dan penolakan** = entri `consents` versi 1 + `consent_signatures` + PDF lewat `ClinicalSigningService` (ADR-0029), lalu TTE dokter pemberi penjelasan. Versi itu langsung terkunci (`RECORD_LOCKED`). Event `consent.signed` dengan `outcome`. Langkah yang mengubah draf mengunci barisnya (`FOR UPDATE`), sehingga finalisasi ganda serentak hanya terjadi sekali.
6. **Pencabutan = entri baru.** Versi ber-TTE tidak bisa digantikan (ADR-0028 butir 4), jadi pencabutan adalah entri `consents` baru `dicabut` yang menunjuk persetujuan lewat `addendum_of`, dengan tanda tangan pasien/wali dan PDF + TTE sendiri. Persetujuan asal tampil dengan `effectiveDecision = dicabut`. Hanya persetujuan `setuju` final yang bisa dicabut, sekali.
7. **Gambar tanda tangan** diunggah biner langsung ke draf (`POST /consents/drafts/:id/signature-image?slot=`, PNG ≤ 512 KB, ADR-0020) dan disimpan sebagai dokumen pasien `kind = consent`. Perawat tidak perlu izin `documents.write` umum. Unggahan P08 umum tetap diterima bila PNG milik pasien yang sama.
8. **Edukasi** memakai formulir P07 `edukasi_terintegrasi` dengan `encounterId` (tanpa tabel baru).

## Konsekuensi

- Kode galat baru: `CONSENT_SIGNATURES_REQUIRED` (422, `details.missing`) dan `CONSENT_CLOSED` (409).
- Draf yang tidak pernah difinalkan tetap tersimpan berstatus `draf` (bukan rekam medis). Belum ada job pembersihan; layar menampilkan dan membatalkannya.
- Gambar tanda tangan tidak ditanam di PDF. PDF mencantumkan nama + cara tanda tangan, berkasnya tetap di dokumen pasien.
- Jalur demo (`DATA_SOURCE=demo`) tidak berubah. Layar tablet mode api (W5a) memakai endpoint ini.
