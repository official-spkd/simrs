# ADR-0106 · Kamar operasi API: persetujuan di sign in dan time out, butir sistem, tim operasi sebagai rawat bersama

Status: diusulkan · 7 Okt 2026 (fase 4 potongan 4.7, agen A4) · diperbarui 8 Okt 2026 (4.7b, 4.7c)

## Konteks

Skema 4.0b (ADR-0037) sudah menegakkan urutan daftar tilik WHO, gerbang insisi, hitung kasa, dan bentrok kamar di DB.
Potongan 4.7 membangun API `/api/v1/surgery` dan layar Kamar operasi mode api di atasnya. Beberapa hal tidak diatur
skema atau rencana fase 4 §4.7:

1. Trigger 4.0b tidak memeriksa persetujuan tindakan. Rencana meminta butir "persetujuan tindakan" diisi sistem dari
   persetujuan 3.7, dan koordinator meminta time out memeriksa persetujuan itu juga.
2. Laporan operasi memakai `ClinicalRecordService` + `issueSigned`, yang mensyaratkan relasi pasien. Operator yang
   dijadwalkan untuk pasien bangsal lain belum tentu ada di tim perawatan kunjungan, sehingga laporannya ditolak 403.
3. Matriks bawaan 4.0a tidak memberi siapa pun izin `surgery.schedule`.
4. Override insisi sebelum time out harus "memberi notifikasi komite mutu", tetapi belum ada peran komite mutu.

## Keputusan

1. **Persetujuan diperiksa di service, dua kali.** Persetujuan berlaku = baris `consents` kunjungan itu dengan keputusan
   `setuju`, status `final`, bukan adendum, belum digantikan, dan tanpa adendum `dicabut` yang final. Konfirmasi
   **sign in** tanpa persetujuan berlaku ditolak 409 `CHECKLIST_INCOMPLETE` (`details.consent = false`). Bila ada,
   server mengisi butir sistem persetujuan dan menyimpan `consent_id` di kasus. Konfirmasi **time out** memeriksa
   ulang, sehingga persetujuan yang dicabut di antara sign in dan time out menahan insisi.
2. **Butir sistem hanya diisi server.** Butir persetujuan (saat sign in) dan butir hitung (saat sign out, setelah semua
   butir hitung cocok atau ditindaklanjuti) ditulis server. Centang manual atas butir sistem ditolak, sesuai guard
   4.0b.
3. **Dokter tim operasi masuk tim perawatan kunjungan sebagai `rawat_bersama`** (operator, asisten, anestesi) lewat
   `CareTeamService` saat dijadwalkan, bila belum menjadi anggota. Saat kasus dibatalkan, keanggotaan itu diakhiri
   kecuali dokter masih bertugas di kasus aktif lain pada kunjungan yang sama. Laporan operasi hanya boleh ditulis
   operator kasus.
4. **`surgery.schedule` lingkup `unit` untuk perawat** (`NURSE_SUPPORT`). Lingkup unit = unit berjenis
   `kamar_operasi`, sehingga dalam praktik hanya perawat unit OK yang menjadwalkan. Dokter tidak menjadwalkan
   langsung.
5. **Notifikasi override** berjenis `surgery_override` (tanpa PHI, tautan audit per pasien) dikirim ke peran
   `auditor_mutu` dan `manajemen`. Peristiwa insisi menyimpan alasan override, dan audit menandai `review` untuk
   ditinjau mutu. Panjang minimum alasan dari setelan RS (bawaan 15 karakter), sama dengan trigger 4.0b.
6. **Daftar staf untuk pilihan tim** (`GET surgery/staff`) memuat semua staf klinis aktif (dokter, dokter residen,
   perawat), dengan batas teknis 2.000 baris. Batas 300 sebelumnya membuat dokter baru tidak muncul.

## Konsekuensi

- Grant baru untuk kunci katalog lama (`surgery.schedule` sudah ada di katalog 4.0a) tidak ditambahkan
  `syncRolePermissions` biasa. DB yang sudah ber-seed perlu `pnpm db:sync-permissions --reconcile` agar perawat
  mendapat izin jadwal.
- Dokter tim terlihat di tim perawatan kunjungan dan mendapat akses relasi selama kasus aktif. Ini disengaja: operator
  perlu membaca rekam medis pasien yang dioperasi.
- Layar berlangganan SSE papan OK dari 4.1a (`/support/streams/surgery-board?date=`, lewat BFF
  `/penunjang/kamar-operasi/events`). Kanal itu hanya dipicu `surgery_case_status_history`, jadi centang butir dan
  hitung dari jendela lain baru tampil saat papan dimuat ulang berikutnya.
- Belum di 4.7: asesmen pra-anestesi dan catatan anestesi lewat formulir P07, dan order PA (S02) dari spesimen di
  laporan (baru penanda).
- Status registri layar `ok` tetap `demo`, sama dengan layar hibrida lain (IGD, Depo). Menu mode api mengikuti izin
  `surgery.read`.

## Pembaruan 8 Okt 2026 · 4.7b (anestesi P07, revisi laporan, spesimen PA, SSE aktivitas)

1. **Asesmen pra-anestesi dan catatan anestesi = formulir P07 pustaka** (`asesmen_pra_anestesi`,
   `catatan_anestesi` di `schemas/anestesi.ts`, hak tulis `dokter`), diseed `seedSupportMasters`, diisi lewat API
   formulir biasa (`POST /patients/:id/forms/:code/responses` + `encounterId`). Tidak ada tabel anestesi baru: formulir
   tetap data yang bisa diterbitkan ulang komite RM selama kode dan kunci `asa` tetap.
2. **Sign in menuntut asesmen pra-anestesi final** untuk kunjungan kasus: isian terkini rantai versi berstatus `final`
   (salah entri tidak dihitung). Tanpa itu 409 `CHECKLIST_INCOMPLETE` dengan `details.preAnesthesia = false`. Gerbang
   ini di service, seperti persetujuan tindakan, karena kode formulir bisa diatur RS.
3. **Revisi laporan operasi** memakai API 4.7 (`revision`): adendum kapan saja; koreksi beralasan hanya bila TTE versi
   itu gagal (versi ber-TTE berjalan/sah terkunci, ADR-0028 → 409 `RECORD_LOCKED`). Sasaran revisi harus laporan kasus
   yang sama (lain → 404). Judul dokumen TTE: "Koreksi laporan operasi" / "Adendum laporan operasi".
4. **Spesimen PA terstruktur** di `surgery_specimens` (append-only, label `OK-YYMM-NNNN-S<n>`, trigger: laporan final
   non-adendum kasus yang sama), dikirim operator setelah laporan menyatakan ada spesimen. Setiap spesimen menerbitkan
   `surgery.specimen_sent` (muatan tanpa isi klinis). Kontrak untuk order PA 4.8 (A2) ada di
   `packages/shared/src/schemas/surgery-specimen.ts`; penangan event membaca baris spesimen di transaksi yang sama.
5. **SSE aktivitas papan OK** di kanal baru `support_surgery_activity`: `app_notify_row` AFTER INSERT di semua tabel
   append-only kasus (riwayat status, butir tilik, konfirmasi, peristiwa, hitung, tindak lanjut, BHP, laporan,
   spesimen) dan di `form_responses` untuk dua kode formulir anestesi. Endpoint `GET /surgery/board/events?date=`
   (lingkup sama dengan papan, berlangganan diaudit). Kanal 4.1a `support_surgery_board` tidak diubah; layar OK pindah ke
   aliran aktivitas. Tanpa `replay`: sambung ulang dengan `Last-Event-ID` menerima `reset` lalu layar memuat ulang.

Konsekuensi tambahan: catatan "belum di 4.7" untuk formulir anestesi, order PA, dan SSE butir di atas tertutup, kecuali
pembuatan order PA itu sendiri (penangan event di 4.8). Penata anestesi (perawat) belum bisa mengisi catatan anestesi
karena hak tulis pustaka hanya `dokter` dan lingkup tulis formulir perawat = unit bangsal pasien; RS bisa menerbitkan
versi formulir dengan hak tulis lain bila lingkupnya disesuaikan.

## Pembaruan 8 Okt 2026 · 4.7c (penata anestesi)

1. **Catatan anestesi mengikuti tim kasus.** `POST /surgery/cases/:id/anesthesia-records` (izin `surgery.checklist`)
   menulis formulir `catatan_anestesi` bila pelaku anggota aktif tim kasus berperan `anestesi` atau `penata_anestesi`,
   atau anggota tim lain yang profesinya tercantum di hak tulis formulir. Lingkup unit bangsal formulir P07 tidak
   dipakai. `FormResponsesService.createAuthorized` memakai validasi isian yang sama tetapi menyerahkan otorisasi ke
   pemanggil; koreksi dan salah entri tetap lewat API formulir (hak tulis profesi).
2. **Asesmen pra-anestesi tetap dokter** (API formulir, hak tulis `dokter`).
3. **Profesi harus cocok dengan peran tim** saat dijadwalkan: operator/asisten/anestesi = dokter atau dokter residen;
   penata anestesi/perawat instrumen/perawat sirkuler = perawat atau bidan (selain itu 422).
4. **Anggota tim aktif boleh membuka kasusnya** walau lingkup unitnya bukan unit OK (mis. penata anestesi dari unit
   lain). Papan OK tetap hanya untuk unit OK.

Butir penutup 4.7b tentang penata anestesi tertutup oleh pembaruan ini.
